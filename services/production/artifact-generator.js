"use strict";

const fs = require("fs");
const path = require("path");
const { Document, HeadingLevel, Packer, Paragraph } = require("docx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const JSZip = require("jszip");
const sharp = require("sharp");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { nextVersionedPath, safeBaseName } = require("./versioning");

const FORMATS = new Set(["docx", "pdf", "png", "xlsx", "pptx", "md", "html", "rtf", "txt", "json", "csv"]);
const MIME_TYPES = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", png: "image/png", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", md: "text/markdown", html: "text/html", rtf: "application/rtf", txt: "text/plain", json: "application/json", csv: "text/csv" };

function escapeXml(value) { return String(value).replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]); }
function escapeRtf(value) { return String(value).replace(/\\/g, "\\\\").replace(/[{}]/g, "\\$&").replace(/[^\x00-\x7F]/g, (character) => `\\u${character.charCodeAt(0)}?`); }
function lines(value) { return String(value || "").replace(/\r/g, "").split("\n"); }
function wrapText(value, maximum = 88) { const output = []; for (const paragraph of lines(value)) { if (!paragraph) { output.push(""); continue; } let remaining = paragraph; while (remaining.length > maximum) { let cut = remaining.lastIndexOf(" ", maximum); if (cut < 20) cut = maximum; output.push(remaining.slice(0, cut)); remaining = remaining.slice(cut).trimStart(); } output.push(remaining); } return output; }

async function docxBuffer(title, content) {
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const line of lines(content)) children.push(new Paragraph({ text: line || " " }));
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

async function pdfBuffer(title, content) {
  const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]); let y = 790;
  const addLine = (text, size = 11, selectedFont = font) => { if (y < 50) { page = document.addPage([595, 842]); y = 790; } page.drawText(text, { x: 48, y, size, font: selectedFont, color: rgb(0.05, 0.05, 0.05) }); y -= size * 1.5; };
  addLine(String(title).slice(0, 80), 20, bold); y -= 8; for (const line of wrapText(content)) addLine(line);
  return Buffer.from(await document.save());
}

async function xlsxBuffer(title, content) {
  const rows = lines(content).filter((line) => line.length).map((line) => line.split(/\t|,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((cell) => cell.replace(/^\"|\"$/g, "")));
  if (!rows.length) rows.push([title]);
  const columnName = (index) => { let value = index + 1; let output = ""; while (value) { value -= 1; output = String.fromCharCode(65 + value % 26) + output; value = Math.floor(value / 26); } return output; };
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`).join("")}</row>`).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(safeBaseName(title).slice(0, 31) || "Noon")}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  zip.file("xl/styles.xml", `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function pptxBuffer(title, content) {
  const chunks = String(content || "").split(/\n\s*---\s*\n/).filter(Boolean); const slides = chunks.length ? chunks : [content];
  const zip = new JSZip(); const selectedSlides = slides.slice(0, 40);
  const overrides = selectedSlides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides}<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${selectedSlides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${selectedSlides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`);
  selectedSlides.forEach((chunk, index) => { const chunkLines = lines(chunk); const slideTitle = (index === 0 ? title : chunkLines.shift()) || title; const body = chunkLines.join("\n") || String(chunk); zip.file(`ppt/slides/slide${index + 1}.xml`, `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Titre"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="450000"/><a:ext cx="11000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR" sz="2800" b="1"/><a:t>${escapeXml(slideTitle)}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Contenu"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="650000" y="1500000"/><a:ext cx="10800000" cy="4500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR" sz="1700"/><a:t>${escapeXml(body)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`); zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`); });
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file("ppt/theme/theme1.xml", `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Noon"><a:themeElements><a:clrScheme name="Noon"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="F7F7F4"/></a:lt2><a:accent1><a:srgbClr val="BAFF00"/></a:accent1><a:accent2><a:srgbClr val="777777"/></a:accent2><a:accent3><a:srgbClr val="555555"/></a:accent3><a:accent4><a:srgbClr val="333333"/></a:accent4><a:accent5><a:srgbClr val="999999"/></a:accent5><a:accent6><a:srgbClr val="CCCCCC"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Arial"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Noon"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function pngBuffer(title, content) {
  const body = wrapText(content, 52).slice(0, 20).map((line, index) => `<text x="90" y="${230 + index * 43}" font-family="Arial, sans-serif" font-size="28" fill="#171717">${escapeXml(line)}</text>`).join("");
  const svg = `<svg width="1600" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="1200" fill="#f7f7f4"/><rect x="50" y="70" width="12" height="1060" fill="#baff00"/><text x="90" y="150" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="#0d0d0d">${escapeXml(title)}</text>${body}<text x="1420" y="1130" font-family="Arial" font-size="24" fill="#777">NOON</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function buildBuffer(format, title, content) {
  if (format === "docx") return docxBuffer(title, content);
  if (format === "pdf") return pdfBuffer(title, content);
  if (format === "xlsx") return xlsxBuffer(title, content);
  if (format === "pptx") return pptxBuffer(title, content);
  if (format === "png") return pngBuffer(title, content);
  if (format === "rtf") return Buffer.from(`{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\fs36\\b ${escapeRtf(title)}\\b0\\fs24\\par ${escapeRtf(content).replace(/\n/g, "\\par ")}}`, "utf8");
  if (format === "html") return Buffer.from(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>${escapeXml(title)}</title><body><h1>${escapeXml(title)}</h1>${lines(content).map((line) => `<p>${escapeXml(line)}</p>`).join("")}</body></html>`, "utf8");
  return Buffer.from(String(content), "utf8");
}

async function verifyArtifact(filePath, format) {
  const stats = fs.statSync(filePath); if (!stats.isFile() || stats.size === 0) throw new Error("Le livrable généré est vide.");
  if (format === "pdf") await PDFDocument.load(fs.readFileSync(filePath));
  if (format === "xlsx") { const zip = await JSZip.loadAsync(fs.readFileSync(filePath)); if (!zip.file("xl/workbook.xml") || !zip.file("xl/worksheets/sheet1.xml")) throw new Error("Classeur Open XML invalide."); }
  if (format === "png") await sharp(filePath).metadata();
  if (["docx", "pptx"].includes(format) && fs.readFileSync(filePath).subarray(0, 2).toString() !== "PK") throw new Error("Archive bureautique invalide.");
  if (format === "pptx") { const zip = await JSZip.loadAsync(fs.readFileSync(filePath)); if (!zip.file("ppt/presentation.xml") || !zip.file("ppt/slides/slide1.xml")) throw new Error("Présentation Open XML invalide."); }
  return stats;
}

async function generateArtifact({ format, title, content, outputDirectory, project = "Noon" }, writableRoots) {
  const normalizedFormat = String(format || "").toLowerCase(); if (!FORMATS.has(normalizedFormat)) throw new Error("Format de livrable non pris en charge.");
  const directory = fs.realpathSync(path.resolve(String(outputDirectory || "")));
  const normalizedRoots = writableRoots.map((root) => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } });
  if (!isPathInsideRoots(directory, normalizedRoots)) throw new Error("Choisissez un dossier autorisé en lecture et création dans les réglages.");
  const destination = nextVersionedPath(directory, project, title, normalizedFormat); const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try { fs.writeFileSync(temporary, await buildBuffer(normalizedFormat, String(title || "Livrable").slice(0, 120), String(content || ""))); await verifyArtifact(temporary, normalizedFormat); fs.renameSync(temporary, destination); const stats = await verifyArtifact(destination, normalizedFormat); return { name: path.basename(destination), type: MIME_TYPES[normalizedFormat], format: normalizedFormat, size: stats.size, path: destination, directory, createdAt: new Date().toISOString() }; }
  catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}

module.exports = { FORMATS, generateArtifact, verifyArtifact };
