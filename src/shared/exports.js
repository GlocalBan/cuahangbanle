/* Export utilities: UTF-8 BOM CSV/Excel and safe in-page Print/PDF via #print-area. */
'use strict';

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV(rows, filename) {
  const safe = (v) => {
    let s = String(v ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  download(
    '\uFEFF' + rows.map((row) => row.map(safe).join(',')).join('\r\n'),
    filename,
    'text/csv;charset=utf-8',
  );
}

function printReportHTML(html) {
  const printArea = $('#print-area');
  if (!printArea) {
    throw new Error('Không tìm thấy vùng in báo cáo (#print-area).');
  }
  printArea.innerHTML = html;
  window.print();
}
