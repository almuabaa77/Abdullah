import { strToU8, zipSync } from 'fflate'
const xml = (value:string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const root = 'http://schemas.openxmlformats.org'
export function exportWorkbook(rows:(string|number)[][], filename:string, rtl:boolean) {
  const sheet = rows.map((row,i)=>`<row r="${i+1}">${row.map(value=>typeof value==='number'?`<c><v>${value}</v></c>`:`<c t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')
  const files: Record<string,string> = {
    '[Content_Types].xml':`<Types xmlns="${root}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels':`<Relationships xmlns="${root}/package/2006/relationships"><Relationship Id="rId1" Type="${root}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${root}/package/2006/relationships"><Relationship Id="rId1" Type="${root}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="${root}/spreadsheetml/2006/main" xmlns:r="${root}/officeDocument/2006/relationships"><sheets><sheet name="${rtl?'السجل':'Records'}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${root}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="${rtl?1:0}"><pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="9" width="23" customWidth="1"/></cols><sheetData>${sheet}</sheetData></worksheet>`,
  }
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8('<?xml version="1.0" encoding="UTF-8"?>'+text)])))
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename+'.xlsx';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
