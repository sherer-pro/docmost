import { type Kysely, sql } from 'kysely';

const PAGE_VECTOR = sql`
  setweight(
    to_tsvector(
      'english',
      f_unaccent(translate(coalesce(title, ''), '«»', '  '))
    ),
    'A'
  ) ||
  setweight(
    to_tsvector(
      'english',
      f_unaccent(
        translate(substring(coalesce(text_content, '') FROM 1 FOR 1000000), '«»', '  ')
      )
    ),
    'B'
  )
`;

const ATTACHMENT_VECTOR = sql`
  setweight(
    to_tsvector(
      'english',
      f_unaccent(translate(coalesce(file_name, ''), '«»', '  '))
    ),
    'A'
  ) ||
  setweight(
    to_tsvector(
      'english',
      f_unaccent(
        translate(substring(coalesce(text_content, '') FROM 1 FOR 1000000), '«»', '  ')
      )
    ),
    'B'
  )
`;

export async function up(db: Kysely<any>): Promise<void> {
  // The stock unaccent dictionary expands guillemets to << and >>. PostgreSQL
  // then treats the enclosed word as markup while building a tsvector. Remove
  // only those delimiters before unaccenting so the searchable word survives.
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.tsv :=
        setweight(
          to_tsvector(
            'english',
            f_unaccent(translate(coalesce(NEW.title, ''), '«»', '  '))
          ),
          'A'
        ) ||
        setweight(
          to_tsvector(
            'english',
            f_unaccent(
              translate(
                substring(coalesce(NEW.text_content, '') FROM 1 FOR 1000000),
                '«»',
                '  '
              )
            )
          ),
          'B'
        );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION attachments_tsvector_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.tsv :=
        setweight(
          to_tsvector(
            'english',
            f_unaccent(translate(coalesce(NEW.file_name, ''), '«»', '  '))
          ),
          'A'
        ) ||
        setweight(
          to_tsvector(
            'english',
            f_unaccent(
              translate(
                substring(coalesce(NEW.text_content, '') FROM 1 FOR 1000000),
                '«»',
                '  '
              )
            )
          ),
          'B'
        );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`UPDATE pages SET tsv = ${PAGE_VECTOR}`.execute(db);
  await sql`UPDATE attachments SET tsv = ${ATTACHMENT_VECTOR}`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.tsv :=
        setweight(
          to_tsvector('english', f_unaccent(coalesce(NEW.title, ''))),
          'A'
        ) ||
        setweight(
          to_tsvector(
            'english',
            f_unaccent(substring(coalesce(NEW.text_content, '') FROM 1 FOR 1000000))
          ),
          'B'
        );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION attachments_tsvector_trigger()
    RETURNS trigger AS $$
    BEGIN
      NEW.tsv :=
        setweight(
          to_tsvector('english', f_unaccent(coalesce(NEW.file_name, ''))),
          'A'
        ) ||
        setweight(
          to_tsvector(
            'english',
            f_unaccent(substring(coalesce(NEW.text_content, '') FROM 1 FOR 1000000))
          ),
          'B'
        );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);

  await sql`
    UPDATE pages
    SET tsv =
      setweight(to_tsvector('english', f_unaccent(coalesce(title, ''))), 'A') ||
      setweight(
        to_tsvector(
          'english',
          f_unaccent(substring(coalesce(text_content, '') FROM 1 FOR 1000000))
        ),
        'B'
      )
  `.execute(db);
  await sql`
    UPDATE attachments
    SET tsv =
      setweight(to_tsvector('english', f_unaccent(coalesce(file_name, ''))), 'A') ||
      setweight(
        to_tsvector(
          'english',
          f_unaccent(substring(coalesce(text_content, '') FROM 1 FOR 1000000))
        ),
        'B'
      )
  `.execute(db);
}
