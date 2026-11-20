import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { v5 as uuid5 } from 'uuid';
import { InjectKysely } from 'nestjs-kysely';
import { sql, type Selectable } from 'kysely';
import * as bytes from 'bytes';
import { markdownToHtml, sanitizeUrl } from '@docmost/editor-ext/server';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import type {
  Comment,
  Page,
  Space,
  User,
} from '@docmost/db/types/entity.types';
import type {
  KyselyDB,
  KyselyTransaction,
} from '@docmost/db/types/kysely.types';
import type { McpWriteOperationRow } from '@docmost/db/types/mcp-write.types';
import {
  COLLABORATION_DOCUMENT_PORT,
  type CollaborationDocumentPort,
} from '../../collaboration/collaboration-document.port';
import {
  htmlToJson,
  prosemirrorNodeToYJson,
  strictJsonToNode,
} from '../../collaboration/collaboration.util';
import { hashCanonicalJson } from '../../common/helpers/canonical-json.util';
import {
  validateFileExtensionAndSignature,
  resolveTrustedMimeType,
} from '../../common/helpers/file-validation';
import {
  hashProseMirrorJson,
  type ProseMirrorJson,
} from '../../common/helpers/prosemirror/ai-page-operation';
import {
  applyMcpContentEdit,
  MCP_TEXT_NODES,
  MCP_TABLE_NODES,
  type McpContentEdit,
} from '../../common/helpers/prosemirror/mcp-content-edit';
import { PAGE_TREE_LOCK_NAMESPACE } from '../../common/config/page-tree.constants';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { DrawioSourceService } from '../../collaboration/services/drawio-source.service';
import type { McpContentCommand } from '../../collaboration/collaboration-document.port';
import { DRAWIO_FILE_NAME, makeDrawioSvg } from './mcp-drawio';
import { QueueOutboxService } from '../../integrations/queue/outbox/queue-outbox.service';
import { AiContentPolicyService } from '../ai-content-policy/ai-content-policy.service';
import { postgresJsonb } from '../ai/utils/postgres-jsonb.util';
import { AttachmentType } from '../attachment/attachment.constants';
import { getAttachmentFolderPath } from '../attachment/attachment.utils';
import { AttachmentService } from '../attachment/services/attachment.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { CommentService } from '../comment/comment.service';
import { PageAccessService } from '../page-access/page-access.service';
import { PageService } from '../page/services/page.service';
import { MCP_IMAGE_MAX_BYTES } from '../../common/config/mcp-body-limit';
import {
  parseMcpWriteInput,
  type McpWriteInput,
  type McpWriteToolName,
} from './mcp-write-contract';

type WriteContext = {
  keyId: string;
  user: User;
  space: Space;
  reauthorize: () => Promise<User>;
};

type Target = { page?: Page; thread?: Comment; state: Record<string, unknown> };
type ContentPlan = { edit: McpContentEdit; afterHash: string };
type ImagePlan = {
  fileName: string;
  fileExtension: string;
  mimeType: string;
  buffer: Buffer;
};
type Plan = {
  diagram?: { command: NonNullable<McpContentCommand['diagram']>; svg: Buffer };
  preview: Record<string, unknown>;
  content?: ContentPlan;
  image?: ImagePlan;
};
type Receipt = Selectable<McpWriteOperationRow>;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MARKDOWN_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link']);

@Injectable()
export class McpWriteService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(COLLABORATION_DOCUMENT_PORT)
    private readonly collaboration: CollaborationDocumentPort,
    private readonly pageRepo: PageRepo,
    private readonly commentRepo: CommentRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly access: PageAccessService,
    private readonly contentPolicy: AiContentPolicyService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pages: PageService,
    private readonly comments: CommentService,
    private readonly attachments: AttachmentService,
    private readonly environment: EnvironmentService,
    private readonly outbox: QueueOutboxService,
    private readonly drawioSource: DrawioSourceService,
  ) {}

  async execute(
    tool: McpWriteToolName,
    raw: unknown,
    context: WriteContext,
  ): Promise<unknown> {
    const input = parseMcpWriteInput(tool, raw);
    if (input.spaceId !== context.space.id)
      throw new ForbiddenException('MCP key does not authorize this space');
    const { keyId } = context;
    const targetId = input.pageId ?? input.parentPageId ?? null;
    const binding = {
      keyId,
      operationId: input.operationId!,
      actorId: context.user.id,
      tool,
      spaceId: input.spaceId,
      pageId: targetId,
      threadId: input.threadId ?? null,
    };
    const target = await this.loadTarget(tool, input, context);
    if (input.mode === 'inspect') {
      return {
        target: target.state,
        revision: await this.revision(tool, target, context),
      };
    }
    const existing = await this.findReceipt(keyId, binding.operationId);
    if (existing) {
      if (
        (Object.keys(binding) as Array<keyof typeof binding>).some(
          (key) => existing[key] !== binding[key],
        )
      )
        this.operationMismatch();
    }
    if (input.mode === 'status') {
      if (existing) await this.assertResultAccess(existing, context);
      return this.status(existing);
    }

    const expectedRevision = input.expectedRevision!;
    // Bind raw scalar input and object keys canonically. Image bytes are bound
    // by their verified SHA-256 and are never written to a receipt.
    const {
      mode: _mode,
      previewHash: suppliedHash,
      base64: _base64,
      ...payload
    } = input;
    const payloadHash = hashCanonicalJson({
      contract: 1,
      tool,
      keyId,
      payload,
    });
    if (
      existing &&
      (existing.expectedRevision !== expectedRevision ||
        existing.payloadHash !== payloadHash)
    ) {
      this.operationMismatch();
    }
    if (tool === 'uploadPageImage') this.assertImageBytes(input);
    if (
      input.mode === 'commit' &&
      (!existing || suppliedHash !== existing.previewHash)
    ) {
      throw new ConflictException(
        'A matching preview is required before commit',
      );
    }
    if (existing?.result) {
      await this.assertResultAccess(existing, context);
      return this.status(existing);
    }
    if (input.mode === 'preview') {
      const plan = await this.buildPlan(tool, input, target, context);
      const previewHash = this.planPreviewHash(payloadHash, plan, existing?.previewHash);
      const preview = {
        operationId: binding.operationId,
        expectedRevision,
        previewHash,
        ...plan.preview,
      };
      if (Buffer.byteLength(JSON.stringify(preview)) > 24 * 1024) {
        throw new BadRequestException(
          'The exact preview exceeds 24 KiB. Use a smaller edit.',
        );
      }
      const actor = await context.reauthorize();
      if (actor.id !== binding.actorId) throw new ForbiddenException();
      await this.db
        .insertInto('mcpWriteOperations')
        .values({ ...binding, expectedRevision, payloadHash, previewHash })
        .onConflict((oc) => oc.columns(['keyId', 'operationId']).doNothing())
        .execute();
      const stored = await this.findReceipt(keyId, binding.operationId);
      if (stored?.previewHash !== previewHash || stored.actorId !== actor.id)
        this.operationMismatch();
      return preview;
    }
    if (tool === 'editPageContent') {
      return this.commitContent(input, target, context, existing!);
    }
    const outcome = await this.db.transaction().execute(async (trx) => {
      const receipt = await this.findReceipt(keyId, binding.operationId, trx);
      if (!receipt || receipt.payloadHash !== payloadHash)
        this.operationMismatch();
      const user = await context.reauthorize();
      const liveContext = { ...context, user };
      if (tool === 'createPage') {
        await sql`select pg_advisory_xact_lock(${sql.lit(PAGE_TREE_LOCK_NAMESPACE)}, hashtext(${input.spaceId}))`.execute(
          trx,
        );
      }
      const current = await this.loadTarget(tool, input, liveContext, trx);
      if (receipt.result) return receipt;
      const plan = await this.buildPlan(tool, input, current, liveContext, trx);
      this.assertPreview(receipt, plan);
      const result = await this.applyRelational(
        tool,
        input,
        plan,
        liveContext,
        current,
        trx,
      );
      if (
        tool === 'createPage' ||
        tool === 'updatePageTitle' ||
        tool === 'replyToComment'
      ) {
        await this.outbox.enqueueMcpPageMutation(
          {
            mutation:
              tool === 'createPage'
                ? 'create'
                : tool === 'updatePageTitle'
                  ? 'rename'
                  : 'reply',
            deliveryId: uuid5(binding.operationId, keyId),
            pageId: result.pageId,
            spaceId: input.spaceId,
            workspaceId: context.space.workspaceId,
            actorId: user.id,
          },
          trx,
        );
      }
      await trx
        .updateTable('mcpWriteOperations')
        .set({ startedAt: new Date(), result: postgresJsonb(result) as never })
        .where('keyId', '=', keyId)
        .where('operationId', '=', binding.operationId)
        .execute();
      return { ...receipt, result: result as Receipt['result'] };
    });
    this.outbox.kick();
    await this.assertResultAccess(outcome, context);
    return this.status(outcome);
  }

  private async loadTarget(
    tool: McpWriteToolName,
    input: McpWriteInput,
    context: WriteContext,
    trx?: KyselyTransaction,
  ): Promise<Target> {
    const { space, user } = context;
    const pageId = input.pageId ?? input.parentPageId;
    if (!pageId) {
      const currentSpace = await (trx ?? this.db)
        .selectFrom('spaces')
        .select(['id', 'workspaceId', 'archivedAt', 'updatedAt'])
        .where('id', '=', space.id)
        .executeTakeFirst();
      if (
        !currentSpace ||
        currentSpace.archivedAt ||
        currentSpace.workspaceId !== space.workspaceId
      ) {
        throw new NotFoundException('Space not found');
      }
      const ability = await this.spaceAbility.createForUser(user, space.id);
      if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page))
        throw new ForbiddenException();
      return {
        state: {
          spaceId: space.id,
          parentPageId: null,
          updatedAt: currentSpace.updatedAt.toISOString(),
        },
      };
    }
    const page = await this.pageRepo.findById(pageId, {
      trx,
      withLock: Boolean(trx),
    });
    if (
      !page ||
      page.spaceId !== space.id ||
      page.workspaceId !== space.workspaceId ||
      page.deletedAt ||
      page.templateKind
    ) {
      throw new NotFoundException('Page not found');
    }
    if (tool === 'createPage')
      await this.access.assertCanCreateChild(page, user);
    else await this.access.assertCanWritePage(page, user);
    if (
      await this.contentPolicy.isPageExcluded(
        page.id,
        space.id,
        space.workspaceId,
      )
    ) {
      throw new ForbiddenException('Page is excluded from AI access');
    }
    if (input.threadId) {
      const thread = await this.commentRepo.findById(input.threadId, {
        trx,
        withLock: Boolean(trx),
      });
      if (
        !thread ||
        thread.deletedAt ||
        thread.parentCommentId ||
        thread.pageId !== page.id ||
        thread.spaceId !== page.spaceId ||
        thread.workspaceId !== page.workspaceId
      ) {
        throw new NotFoundException('Comment thread not found');
      }
      return {
        page,
        thread,
        state: {
          pageId: page.id,
          threadId: thread.id,
          updatedAt: thread.updatedAt.toISOString(),
          resolved: Boolean(thread.resolvedAt),
        },
      };
    }
    return {
      page,
      state: {
        pageId: page.id,
        title: page.title,
        spaceId: page.spaceId,
        parentPageId: page.parentPageId,
        updatedAt: page.updatedAt.toISOString(),
      },
    };
  }

  private async revision(
    tool: McpWriteToolName,
    target: Target,
    context: WriteContext,
    trx?: KyselyTransaction,
  ): Promise<string> {
    if (tool === 'editPageContent') {
      return this.collaboration.getPageContentHash(`page.${target.page!.id}`, {
        user: context.user,
      });
    }
    if (target.thread) {
      const replyRevisions = await (trx ?? this.db)
        .selectFrom('comments')
        .select(['id', 'updatedAt'])
        .where('parentCommentId', '=', target.thread.id)
        .where('deletedAt', 'is', null)
        .orderBy('id')
        .$if(Boolean(trx), (query) => query.forUpdate())
        .execute();
      return hashCanonicalJson({
        ...target.state,
        replies: replyRevisions.map((reply) => [
          reply.id,
          reply.updatedAt.toISOString(),
        ]),
      });
    }
    return hashCanonicalJson(target.state);
  }

  private async buildPlan(
    tool: McpWriteToolName,
    input: McpWriteInput,
    target: Target,
    context: WriteContext,
    trx?: KyselyTransaction,
  ): Promise<Plan> {
    if (tool === 'editPageContent')
      return this.planContent(input, target, context);
    this.assertRevision(input, await this.revision(tool, target, context, trx));
    if (input.title !== undefined) {
      if (!input.title.trim() || /[\r\n]/u.test(input.title))
        throw new BadRequestException('Expected a nonempty single-line title');
      if (input.settings?.assigneeId) {
        const members = await this.access.getAssignableSpaceUserIds(
          [input.settings.assigneeId],
          context.space.id,
          context.space.workspaceId,
        );
        if (!members.has(input.settings.assigneeId))
          throw new BadRequestException(
            'Assignee must be an active space member',
          );
      }
      return {
        preview: {
          target: target.state,
          title: input.title,
          ...(input.settings && { settings: input.settings }),
        },
      };
    }
    if (tool === 'uploadPageImage') {
      const buffer = this.assertImageBytes(input);
      const fileName = input.fileName!;
      if (!/^[\p{L}\p{N}][\p{L}\p{N} _.()-]*$/u.test(fileName)) {
        throw new BadRequestException('Invalid image file name');
      }
      await validateFileExtensionAndSignature({
        fileName,
        fileBuffer: buffer,
        allowedExtensions: IMAGE_EXTENSIONS,
      });
      const fileExtension = extname(fileName).toLowerCase();
      const mimeType = resolveTrustedMimeType({
        fileExtension,
        fileBuffer: buffer,
      });
      return {
        preview: {
          target: target.state,
          fileName,
          mimeType,
          bytes: buffer.length,
          sha256: input.sha256,
        },
        image: { fileName, fileExtension, mimeType, buffer },
      };
    }
    if (input.text !== undefined && !input.text.trim())
      throw new BadRequestException('Reply text is empty');
    return {
      preview: {
        target: target.state,
        text: input.text,
        resolved: input.resolved,
      },
    };
  }

  private async planContent(
    input: McpWriteInput,
    target: Target,
    context: WriteContext,
  ): Promise<Plan> {
    const page = target.page!;
    const document = (await this.collaboration.getPageContent(
      `page.${page.id}`,
      { user: context.user },
    )) as ProseMirrorJson;
    const revision = hashProseMirrorJson(document);
    this.assertRevision(input, revision);
    const rawEdit = input.edit!;
    let edit: McpContentEdit;
    let diagram: Plan['diagram'];
    let previewEdit: Record<string, unknown> = rawEdit;
    if (rawEdit.kind === 'replaceDrawio' || rawEdit.kind === 'appendDrawio') {
      const source = rawEdit.kind === 'replaceDrawio'
        ? {
            pageId: page.id,
            spaceId: page.spaceId,
            workspaceId: page.workspaceId,
            attachmentId: rawEdit.attachmentId,
            attachmentVersion: rawEdit.attachmentVersion,
          }
        : undefined;
      if (source) await this.drawioSource.check(source);
      const { svg, modelBytes, sheets, svgSha256 } = makeDrawioSvg(rawEdit);
      if (svg.length > bytes(this.environment.getFileUploadSizeLimit()))
        throw new BadRequestException(
          'The diagram exceeds the file upload limit',
        );
      const id = uuid5(input.operationId!, context.keyId);
      const filePath = `${getAttachmentFolderPath(AttachmentType.File, page.workspaceId)}/${id}/${DRAWIO_FILE_NAME}`;
      diagram = {
        command: {
          ...(source && { source }),
          attachmentId: id,
          filePath,
          size: svg.length,
          modelSha256: rawEdit.modelSha256,
          svgSha256,
        },
        svg,
      };
      const src = this.attachmentUrl(id, DRAWIO_FILE_NAME);
      edit = rawEdit.kind === 'appendDrawio'
        ? {
            kind: 'appendDrawio',
            node: { type: 'drawio', attrs: { attachmentId: id, src, size: svg.length } },
          }
        : {
            kind: 'replaceDrawio',
            nodeId: rawEdit.nodeId,
            attachmentId: rawEdit.attachmentId,
            replacementId: id,
            src,
            size: svg.length,
          };
      previewEdit = {
        kind: rawEdit.kind,
        ...(rawEdit.kind === 'replaceDrawio'
          ? {
              nodeId: rawEdit.nodeId,
              attachmentId: rawEdit.attachmentId,
              attachmentVersion: rawEdit.attachmentVersion,
            }
          : { attachmentId: id }),
        modelSha256: rawEdit.modelSha256,
        modelBytes,
        sheets,
        svgBytes: svg.length,
        svgSha256,
      };
    } else if (rawEdit.kind === 'appendImage') {
      const attachment = await this.attachmentRepo.findById(
        rawEdit.attachmentId,
      );
      if (
        !attachment ||
        attachment.deletedAt ||
        attachment.pageId !== page.id ||
        attachment.spaceId !== page.spaceId ||
        attachment.workspaceId !== page.workspaceId ||
        !IMAGE_EXTENSIONS.includes(attachment.fileExt)
      ) {
        throw new NotFoundException('Image attachment not found on this page');
      }
      edit = {
        kind: 'appendImage',
        node: {
          type: 'image',
          attrs: {
            src: this.attachmentUrl(attachment.id, attachment.fileName),
            attachmentId: attachment.id,
            alt: rawEdit.alt,
          },
        },
      };
    } else if (
      rawEdit.kind === 'appendBlock' ||
      rawEdit.kind === 'replaceBlock' ||
      rawEdit.kind === 'insertBlock'
    ) {
      const node = await this.parseMarkdownBlock(
        rawEdit.markdown,
        context.keyId,
        input.operationId!,
      );
      const { markdown: _markdown, ...editTarget } = rawEdit;
      edit = { ...editTarget, node };
    } else {
      edit = rawEdit;
    }
    const { next, before, after } = applyMcpContentEdit(document, edit);
    let normalized: ProseMirrorJson;
    try {
      const node = strictJsonToNode(next as any);
      node.check();
      normalized = prosemirrorNodeToYJson(node);
    } catch {
      throw new BadRequestException(
        'The content edit does not fit the document schema',
      );
    }
    const afterHash = hashProseMirrorJson(normalized);
    if (afterHash === revision)
      throw new BadRequestException('The content edit has no effect');
    return {
      preview: {
        target: target.state,
        edit: previewEdit,
        before,
        after,
        afterHash,
      },
      content: { edit, afterHash },
      diagram,
    };
  }

  private async parseMarkdownBlock(
    markdown: string,
    keyId: string,
    operationId: string,
  ) {
    let nodes: ProseMirrorJson[];
    try {
      nodes = htmlToJson(await markdownToHtml(markdown)).content;
    } catch {
      throw new BadRequestException('Invalid Markdown block');
    }
    if (nodes?.length !== 1)
      throw new BadRequestException('Supply one Markdown block per edit');
    const assignIds = (node: ProseMirrorJson, path: string) => {
      if (!node.type || !(MCP_TEXT_NODES.has(node.type) || MCP_TABLE_NODES.has(node.type)))
        throw new BadRequestException('Unsupported Markdown node');
      if ((node.type === 'tableHeader' || node.type === 'tableCell') &&
          (node.attrs?.colspan !== 1 || node.attrs?.rowspan !== 1))
        throw new BadRequestException('Markdown tables require unmerged cells');
      for (const mark of node.marks ?? []) {
        if (!mark.type || !MARKDOWN_MARKS.has(mark.type)) {
          throw new BadRequestException('Unsupported Markdown mark or link');
        }
        if (mark.type === 'link') {
          const href = mark.attrs?.href;
          const safeHref = typeof href === 'string' && sanitizeUrl(href);
          if (!safeHref) throw new BadRequestException('Unsupported Markdown mark or link');
          mark.attrs = { ...mark.attrs, href: safeHref };
        }
      }
      if (node.type === 'paragraph' || node.type === 'heading') {
        node.attrs = {
          ...node.attrs,
          id: uuid5(`${operationId}:${path}`, keyId),
        };
      }
      node.content?.forEach((child, index) =>
        assignIds(child, `${path}.${index}`),
      );
    };
    assignIds(nodes[0], '0');
    return nodes[0];
  }

  private async commitContent(
    input: McpWriteInput,
    target: Target,
    context: WriteContext,
    receipt: Receipt,
  ) {
    let plan: Plan;
    try {
      plan = await this.buildPlan('editPageContent', input, target, context);
      this.assertPreview(receipt, plan);
    } catch (error) {
      const current = await this.findReceipt(
        receipt.keyId,
        receipt.operationId,
      );
      if (current?.result) return this.status(current);
      throw error;
    }
    await this.db.transaction().execute(async (trx) => {
      const current = await this.findReceipt(
        receipt.keyId,
        receipt.operationId,
        trx,
      );
      if (!current || current.previewHash !== receipt.previewHash)
        this.operationMismatch();
      if (current.startedAt || current.result) return;
      if (plan.diagram)
        await this.attachments.uploadToDrive(
          plan.diagram.command.filePath,
          plan.diagram.svg,
        );
      await trx
        .updateTable('mcpWriteOperations')
        .set({ startedAt: new Date() })
        .where('keyId', '=', receipt.keyId)
        .where('operationId', '=', receipt.operationId)
        .execute();
    });
    const user = await context.reauthorize();
    const liveTarget = await this.loadTarget('editPageContent', input, {
      ...context,
      user,
    });
    const { edit, afterHash } = plan.content!;
    try {
      await this.collaboration.applyMcpContentEdit(
        `page.${liveTarget.page!.id}`,
        {
          edit,
          diagram: plan.diagram?.command,
          afterHash,
          baseHash: receipt.expectedRevision,
          keyId: receipt.keyId,
          operationId: receipt.operationId,
          previewHash: receipt.previewHash,
          user,
        },
      );
    } catch (error) {
      const current = await this.findReceipt(
        receipt.keyId,
        receipt.operationId,
      );
      if (current?.result) return this.status(current);
      throw error;
    }
    const current = await this.findReceipt(receipt.keyId, receipt.operationId);
    if (!current?.result)
      throw new ServiceUnavailableException(
        'The edit receipt is pending. Check status or retry the same operation.',
      );
    return this.status(current);
  }

  private async applyRelational(
    tool: McpWriteToolName,
    input: McpWriteInput,
    plan: Plan,
    context: WriteContext,
    target: Target,
    trx: KyselyTransaction,
  ) {
    const { user, space, keyId } = context;
    const id = uuid5(input.operationId!, keyId);
    const page = target.page!;
    switch (tool) {
      case 'createPage': {
        const createdPage = await this.pages.create(
          user.id,
          space.workspaceId,
          {
            spaceId: space.id,
            title: input.title,
            settings: input.settings,
            parentPageId: input.parentPageId ?? undefined,
          },
          { pageId: id, trx, deferSideEffects: true },
        );
        return {
          pageId: createdPage.id,
          slugId: createdPage.slugId,
          title: createdPage.title,
        };
      }
      case 'updatePageTitle': {
        await this.pageRepo.updatePage(
          {
            title: input.title,
            updatedAt: new Date(),
            lastUpdatedById: user.id,
            contributorIds: [
              ...new Set([...(page.contributorIds ?? []), user.id]),
            ],
          },
          page.id,
          trx,
          false,
        );
        return { pageId: page.id, title: input.title };
      }
      case 'replyToComment': {
        const content = JSON.stringify({
          type: 'doc',
          content: input.text!.split(/\r?\n/u).map((line) => ({
            type: 'paragraph',
            ...(line && { content: [{ type: 'text', text: line }] }),
          })),
        });
        const reply = await this.comments.create(
          { userId: user.id, page, workspaceId: space.workspaceId, trx },
          {
            pageId: page.id,
            parentCommentId: target.thread!.id,
            content,
            selection: undefined,
          },
        );
        return {
          pageId: page.id,
          threadId: target.thread!.id,
          commentId: reply.id,
        };
      }
      case 'setCommentResolved': {
        const thread = await this.comments.resolve(
          target.thread!,
          {
            commentId: target.thread!.id,
            pageId: page.id,
            resolved: input.resolved!,
          },
          user,
          trx,
        );
        return {
          pageId: page.id,
          threadId: thread.id,
          resolved: Boolean(thread.resolvedAt),
        };
      }
      case 'uploadPageImage': {
        const { buffer, fileName, mimeType, fileExtension } = plan.image!;
        const filePath = `${getAttachmentFolderPath(AttachmentType.File, space.workspaceId)}/${id}/${fileName}`;
        await this.attachments.uploadToDrive(filePath, buffer);
        await context.reauthorize();
        await this.attachments.saveAttachment({
          attachmentId: id,
          filePath,
          type: AttachmentType.File,
          userId: user.id,
          workspaceId: space.workspaceId,
          pageId: page.id,
          spaceId: space.id,
          preparedFile: {
            fileName,
            fileExtension,
            mimeType,
            fileSize: buffer.length,
          },
          trx,
        });
        return {
          pageId: page.id,
          attachmentId: id,
          url: this.attachmentUrl(id, fileName),
          sha256: input.sha256,
        };
      }
      default:
        throw new BadRequestException('Unsupported relational MCP write');
    }
  }

  private assertImageBytes(input: McpWriteInput): Buffer {
    const buffer = Buffer.from(input.base64!, 'base64');
    if (
      !buffer.length ||
      buffer.length > MCP_IMAGE_MAX_BYTES ||
      buffer.length > bytes(this.environment.getFileUploadSizeLimit()) ||
      buffer.toString('base64') !== input.base64 ||
      createHash('sha256').update(buffer).digest('hex') !== input.sha256
    ) {
      throw new BadRequestException(
        'Invalid image size, base64 encoding or SHA-256',
      );
    }
    return buffer;
  }

  private attachmentUrl(id: string, name: string): string {
    return `/api/attachments/files/${id}/${encodeURIComponent(name)}`;
  }

  private async assertResultAccess(receipt: Receipt, context: WriteContext) {
    const result = receipt.result as { pageId?: string } | null;
    if (receipt.tool !== 'createPage' || !result?.pageId) return;
    await this.loadTarget(
      'updatePageTitle',
      { mode: 'status', pageId: result.pageId, spaceId: context.space.id },
      context,
    );
  }

  private findReceipt(
    keyId: string,
    operationId: string,
    trx?: KyselyTransaction,
  ) {
    return (trx ?? this.db)
      .selectFrom('mcpWriteOperations')
      .selectAll()
      .where('keyId', '=', keyId)
      .where('operationId', '=', operationId)
      .$if(Boolean(trx), (query) => query.forUpdate())
      .executeTakeFirst();
  }

  private status(receipt: Receipt | undefined) {
    if (!receipt) return { status: 'unknown' };
    if (receipt.result)
      return {
        status: 'committed',
        operationId: receipt.operationId,
        result: receipt.result,
      };
    return {
      status: receipt.startedAt ? 'pending' : 'previewed',
      operationId: receipt.operationId,
    };
  }

  private assertRevision(input: McpWriteInput, actual: string) {
    if (input.expectedRevision !== actual) {
      throw new ConflictException({
        code: 'MCP_WRITE_STALE',
        message: 'The target changed. Inspect and preview a new operation.',
      });
    }
  }

  private planPreviewHash(payloadHash: string, plan: Plan, previousHash?: string) {
    const preview = plan.preview;
    const original = hashCanonicalJson({ payloadHash, preview });
    if (!plan.content || previousHash === original) return original;

    // Collaboration persistence may advance the row timestamp without changing
    // the live document. Its hash binds the content revision in the payload.
    // Existing previews from earlier versions keep their original binding.
    const { updatedAt: _timestamp, ...target } = preview.target as Record<string, unknown>;
    return hashCanonicalJson({ payloadHash, preview: { ...preview, target } });
  }

  private assertPreview(receipt: Receipt, plan: Plan) {
    if (receipt.previewHash !== this.planPreviewHash(receipt.payloadHash, plan, receipt.previewHash)) {
      throw new ConflictException({
        code: 'MCP_PREVIEW_CHANGED',
        message:
          'The exact preview changed. Inspect and use a new operationId.',
      });
    }
  }

  private operationMismatch(): never {
    throw new ConflictException({
      code: 'MCP_OPERATION_MISMATCH',
      message: 'This operationId belongs to a different preview',
    });
  }
}
