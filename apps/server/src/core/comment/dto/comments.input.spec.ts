import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { COMMENT_LIMIT } from '../comment.constants';
import { PageCommentsQueryDto } from './comments.input';

describe('PageCommentsQueryDto', () => {
  it('defaults comment pagination limit to 500', () => {
    const dto = plainToInstance(PageCommentsQueryDto, { pageId: 'page-1' });
    const errors = validateSync(dto, { stopAtFirstError: true });

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(COMMENT_LIMIT);
  });

  it('accepts string limit=500 from query params', () => {
    const dto = plainToInstance(PageCommentsQueryDto, {
      pageId: 'page-1',
      limit: String(COMMENT_LIMIT),
    });
    const errors = validateSync(dto, { stopAtFirstError: true });

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(COMMENT_LIMIT);
  });

  it('rejects limit > 500', () => {
    const dto = plainToInstance(PageCommentsQueryDto, {
      pageId: 'page-1',
      limit: String(COMMENT_LIMIT + 1),
    });
    const errors = validateSync(dto, { stopAtFirstError: true });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('limit');
    expect(errors[0]?.constraints).toHaveProperty('max');
  });
});
