import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../../..');
const destination = path.resolve(
  process.argv[2] ??
    path.join(repo, 'artifacts/docx-export/visual-fixture.docx'),
);
if (
  !destination.startsWith(path.join(repo, 'artifacts') + path.sep) ||
  !destination.endsWith('.docx')
)
  throw new Error('Fixture output must remain inside repository artifacts');
const require = createRequire(path.join(repo, 'apps/server/package.json'));
const { createCanvas } = require('@napi-rs/canvas');
const { renderDocx } = require(
  path.join(
    repo,
    'apps/server/dist/apps/server/src/integrations/export/docx-renderer.js',
  ),
);
const canvas = createCanvas(640, 180);
const context = canvas.getContext('2d');
context.fillStyle = '#eef2f8';
context.fillRect(0, 0, 640, 180);
context.fillStyle = '#334c80';
context.fillRect(30, 45, 180, 90);
context.fillStyle = '#80a4d0';
context.fillRect(230, 45, 180, 90);
context.fillStyle = '#c8d8e8';
context.fillRect(430, 45, 180, 90);
const image = canvas.toBuffer('image/png').toString('base64');
const html = `<h1>Проверка экспорта документов</h1><p>Этот документ проверяет чтение обычного DOCX в Microsoft Word. В нём есть таблицы, изображение, ссылки, сноска, вложенный список и текст разных направлений.</p><h2>Свойства и данные</h2><p>Снимок представления включает только доступные записи. Числа и условия экспорта должны остаться читаемыми.</p><table><tr><th>Работа</th><th>Статус</th><th>Бюджет, руб.</th></tr><tr><td>Исследование потребностей пользователей</td><td>Завершено</td><td>120 000,00</td></tr><tr><td>Подготовка и проверка прототипа</td><td>В работе</td><td>84 500,00</td></tr><tr><td colspan="2">Итого по доступной выборке</td><td>204 500,00</td></tr></table><h2>Изображение и форматирование</h2><p><img alt="Три этапа работы" src="data:image/png;base64,${image}"></p><p><strong>Полужирный текст</strong>, <em>курсив</em>, <u>подчёркивание</u>, <s>удалённый фрагмент</s> и <code>databaseId</code>. <a href="https://example.test/reference">Внешняя ссылка</a> и <a href="/s/guide/p/source">ссылка на исходную страницу</a>.</p><p>Примечание относится к проверке исходного документа<sup data-type="footnote"><a href="#visual-fn-1">1</a></sup>.</p><ol><li><p>Получить разрешённый снимок.</p><ul><li><p>Проверить доступ к источникам.</p></li><li><p>Сохранить значения и порядок столбцов.</p></li></ul></li><li><p>Открыть файл в Word и проверить содержимое.</p></li></ol><div data-type="pageBreak"></div><h2>Вкладки и разворачиваемое содержимое</h2><section><h3>План</h3><p>Содержимое первой вкладки включено в экспорт.</p><h3>Результаты</h3><p>Содержимое второй вкладки доступно независимо от выбранной вкладки редактора.</p></section><details><summary>Подробности проверки</summary><p>Скрытый в редакторе текст раскрывается при экспорте.</p></details><h2>Код и направление текста</h2><pre><code>const total = rows.reduce((sum, row) =&gt; sum + row.budget, 0);\nconsole.log(total);</code></pre><p dir="rtl">مرحبا بالعالم — проверка смешанного текста — Hello world.</p><p>Завершающий абзац позволяет проверить нижнее поле и переносы страниц.</p><section data-footnotes="true"><ol><li id="visual-fn-1">Сноска должна находиться внизу страницы, а номер — рядом с исходным текстом. <a role="doc-backlink" href="#visual-fnref-1">1</a></li></ol></section>`;
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(
  destination,
  await renderDocx({
    html,
    title: 'Проверка экспорта документов',
    appUrl: 'https://docmost.example.test',
  }),
);
console.log(destination);
