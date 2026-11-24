const FILE_NAME = "gym_tracker_historico.csv";
const HEADERS = [
  "id", "date", "timestamp", "planId", "planName", "day",
  "workoutId", "workout", "exercise", "prescription",
  "setNumber", "setId", "weight", "reps", "failure", "unit"
];

// Execute manualmente apenas se precisar autorizar o Drive ou criar o CSV inicial.
// Não execute novamente se o arquivo atual já contém seu histórico.
function setupDrive() {
  const file = getOrCreateCsv_();
  const result = {ok:true, message:"Arquivo CSV disponível.", name:file.getName(), id:file.getId(), url:file.getUrl()};
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || "");

  if (action === "save" || action === "list") {
    const callback = String(params.callback || "");
    if (!/^gymTrackerCb_[A-Za-z0-9_]+$/.test(callback)) {
      return ContentService.createTextOutput("Invalid callback");
    }
    let result;
    try {
      if (action === "save") result = saveRow_(JSON.parse(params.payload || "{}"));
      else result = {ok:true, records:readRows_()};
    } catch (err) {
      result = {ok:false, error:errorMessage_(err)};
    }
    return ContentService.createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  if (action === "status") {
    try {
      const file = getOrCreateCsv_();
      return json_({ok:true, message:"API online; arquivo CSV disponível.", file:file.getName(), fileId:file.getId(), url:file.getUrl()});
    } catch (err) { return json_({ok:false, error:errorMessage_(err)}); }
  }
  return json_({ok:true, message:"Gym Tracker API online"});
}

function doPost(e) {
  try { return json_(saveRow_(JSON.parse(e.postData.contents))); }
  catch (err) { return json_({ok:false, error:errorMessage_(err)}); }
}

function saveRow_(row) {
  if (!row || !row.id || !row.exercise || row.weight === undefined) {
    throw new Error("Registro incompleto: id, exercise e weight são obrigatórios.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const file = getOrCreateCsv_();
    const content = file.getBlob().getDataAsString("UTF-8");
    const parsed = parseCsv_(content);
    const header = parsed.length ? parsed[0] : [];
    const idIndex = header.indexOf("id");
    if (idIndex >= 0 && parsed.slice(1).some(r => String(r[idIndex] || "") === String(row.id))) {
      return {ok:true, duplicate:true, file:file.getName(), fileId:file.getId()};
    }
    const hasHeader = HEADERS.every((h,i) => header[i] === h);
    let base = content;
    if (!hasHeader) {
      // Migra cabeçalhos antigos sem descartar registros já existentes.
      const migrated = [HEADERS.join(",")];
      parsed.slice(1).forEach(values => {
        const oldRow = {};
        header.forEach((key, i) => oldRow[key] = values[i] == null ? "" : values[i]);
        migrated.push(HEADERS.map(key => csvEscape_(oldRow[key])).join(","));
      });
      base = migrated.join("\r\n") + "\r\n";
    }
    const needsNewline = base.length > 0 && !/[\r\n]$/.test(base);
    const csvRow = HEADERS.map(key => csvEscape_(row[key])).join(",");
    file.setContent(base + (needsNewline ? "\r\n" : "") + csvRow + "\r\n");
    return {ok:true, saved:true, file:file.getName(), fileId:file.getId()};
  } finally { lock.releaseLock(); }
}

function readRows_() {
  const file = getOrCreateCsv_();
  const content = file.getBlob().getDataAsString("UTF-8");
  const table = parseCsv_(content);
  if (!table.length) return [];
  const headers = table[0].map(String);
  const idIndex = headers.indexOf("id");
  if (idIndex < 0) throw new Error("O CSV não contém a coluna id.");
  return table.slice(1).filter(values => values && values[idIndex]).map(values => {
    const row = {};
    headers.forEach((key, i) => row[key] = values[i] == null ? "" : values[i]);
    if (row.setNumber !== "") row.setNumber = Number(row.setNumber);
    if (row.weight !== "" && !isNaN(Number(row.weight))) row.weight = Number(row.weight);
    if (row.failure !== "") row.failure = String(row.failure).toLowerCase() === "true";
    return row;
  });
}

// Parser CSV compatível com campos entre aspas, vírgulas, quebras de linha e aspas escapadas.
function parseCsv_(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(v => v === "")) rows.pop();
  return rows;
}

function getOrCreateCsv_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty("CSV_FILE_ID");
  if (fileId) {
    try { const existing = DriveApp.getFileById(fileId); if (!existing.isTrashed()) return existing; }
    catch (err) {}
    props.deleteProperty("CSV_FILE_ID");
  }
  const file = DriveApp.createFile(FILE_NAME, HEADERS.join(",") + "\r\n", MimeType.CSV);
  props.setProperty("CSV_FILE_ID", file.getId());
  return file;
}
function csvEscape_(value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function errorMessage_(err) { return err && err.message ? err.message : String(err); }
