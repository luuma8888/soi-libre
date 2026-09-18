/* Chronéa 2.1 — fonctions métier pures, sans DOM ni état global. */
const ChroneaCore = (() => {
  'use strict';
  const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
  const MAX_MEDIA_BYTES = 1.5 * 1024 * 1024;
  const QUALIFIERS = ['exact', 'about', 'uncertain', 'before', 'after'];
  const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
    'application/pdf', 'text/plain', 'text/csv', 'application/json',
    'application/zip', 'application/octet-stream'];
  const hasValue = v => v !== '' && v !== null && v !== undefined;
  const clone = value => JSON.parse(JSON.stringify(value));
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message); };
  const leapYear = y => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const daysInMonth = (y, m) => [31, !hasValue(y) || leapYear(Number(y)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(m) - 1];
  function number(value, label, integer = false, limit = Number.MAX_SAFE_INTEGER) {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' ||
        !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit ||
        (integer && !Number.isSafeInteger(Number(value)))) fail(label + ' : valeur invalide.');
    return Number(value);
  }
  function validateDate(y, m, d, label = 'Date') {
    if (hasValue(y)) number(y, label + ' — année', true, 1000000000);
    if (hasValue(m) && (number(m, label + ' — mois', true) < 1 || Number(m) > 12))
      fail(label + ' : le mois doit être compris entre 1 et 12.');
    if (hasValue(d)) {
      const day = number(d, label + ' — jour', true);
      const max = hasValue(m) ? daysInMonth(y, m) : 31;
      if (day < 1 || day > max) fail(label + ' : ce jour n’existe pas dans ce mois' +
        (hasValue(y) ? ' et cette année.' : '.'));
    }
    return true;
  }
  function dateBounds(y, m, d) {
    validateDate(y, m, d);
    if (!hasValue(y)) return null;
    const year = Number(y);
    if (hasValue(d) && !hasValue(m)) return {min: year, max: year + 1, anchor: year + .5, precision: 'partial'};
    if (hasValue(m)) {
      const month = Number(m), start = year + (month - 1) / 12;
      if (hasValue(d)) {
        const min = start + (Number(d) - 1) / (12 * daysInMonth(year, month));
        const max = start + Number(d) / (12 * daysInMonth(year, month));
        return {min, max, anchor: (min + max) / 2, precision: 'day'};
      }
      return {min: start, max: year + month / 12, anchor: start + 1 / 24, precision: 'month'};
    }
    return {min: year, max: year + 1, anchor: year + .5, precision: 'year'};
  }
  function compareParts(a, b) {
    for (let i = 0; i < a.length; i++) {
      const delta = Number(a[i]) - Number(b[i]);
      if (delta) return Math.sign(delta);
    }
    return 0;
  }
  function validateTemporal(time = {}, mode = 'calendar') {
    if (!isObject(time)) fail('Structure temporelle invalide.');
    if (mode === 'universal') {
      if (['startYear', 'startMonth', 'startDay', 'endYear', 'endMonth', 'endDay'].some(key => hasValue(time[key])) || time.ical)
        fail('Une position numérique ne peut pas contenir de date civile.');
      if (hasValue(time.start)) number(time.start, 'Position de début');
      if (hasValue(time.end)) {
        number(time.end, 'Position de fin');
        if (!hasValue(time.start)) fail('Une fin nécessite une position de début.');
        if (Number(time.end) < Number(time.start)) fail('La fin doit suivre le début.');
      }
      if (time.qualifier && !QUALIFIERS.includes(time.qualifier)) fail('Précision numérique inconnue.');
      if (hasValue(time.end) && ['before', 'after'].includes(time.qualifier))
        fail('Choisis un repère ouvert ou un intervalle fermé, pas les deux.');
      if (time.unit !== undefined && typeof time.unit !== 'string') fail('Unité invalide.');
      return true;
    }
    if (mode !== 'calendar') fail('Système temporel inconnu.');
    if (hasValue(time.start) || hasValue(time.end)) fail('Une date civile ne peut pas contenir de position numérique.');
    validateDate(time.startYear, time.startMonth, time.startDay, 'Début');
    validateDate(time.endYear, time.endMonth, time.endDay, 'Fin');
    if (time.certainty && !QUALIFIERS.includes(time.certainty)) fail('Précision calendaire inconnue.');
    if (time.kind && !['point', 'range'].includes(time.kind)) fail('Forme temporelle inconnue.');
    const ends = ['endYear', 'endMonth', 'endDay'].some(k => hasValue(time[k]));
    if (time.kind !== 'range' && ends) fail('Un repère ponctuel ne peut pas contenir une fin.');
    if (time.kind === 'range') {
      if (!hasValue(time.startYear) || !hasValue(time.endYear)) fail('Une période nécessite les années de début et de fin.');
      if (['before', 'after'].includes(time.certainty)) fail('Avant / après s’applique à un repère, pas à une période fermée.');
      // Comparaison des composants, sans arrondi graphique et sans faux jour saisi.
      const a = [time.startYear, time.startMonth || 1, time.startDay || 1];
      const b = [time.endYear, time.endMonth || 12, time.endDay || (time.endMonth ? daysInMonth(time.endYear, time.endMonth) : 31)];
      if (!time.ical && compareParts(a, b) > 0) fail('La fin de la période doit suivre son début.');
    }
    if (time.ical) {
      const start = validateICSDate(time.ical.start);
      const end = time.ical.end ? validateICSDate(time.ical.end) : null;
      if (start.type === 'DATE') fail('Les métadonnées horaires doivent être DATE-TIME.');
      if (end && end.type !== start.type) fail('DTSTART et DTEND doivent avoir le même type.');
      if ((time.kind === 'range') !== !!end || (time.certainty && time.certainty !== 'exact'))
        fail('Les métadonnées horaires doivent correspondre à un repère ou une période exacte.');
      if (end && (!start.value.endsWith('Z') && !start.tzid) !== (!end.value.endsWith('Z') && !end.tzid))
        fail('Les horaires flottants et zonés ne peuvent pas être mélangés.');
      if (end && icsInstant(end) <= icsInstant(start)) fail('DTEND doit suivre DTSTART.');
      const a = icsParts(start.value), b = end ? icsParts(end.value) : null;
      if (compareParts(a.slice(0, 3), [time.startYear, time.startMonth, time.startDay]) !== 0 ||
          (b && compareParts(b.slice(0, 3), [time.endYear, time.endMonth, time.endDay]) !== 0))
        fail('Les dates civiles et les horaires iCalendar ne correspondent pas.');
    }
    return true;
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
      const url = new URL(value.trim());
      return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  function validateLinks(text = '') {
    for (const line of text.split(/\n+/).filter(v => v.trim())) {
      const parts = line.split('|'), url = parts.length > 1 ? parts.slice(1).join('|') : line;
      if (!safeUrl(url.trim())) fail('Lien refusé : utilise http, https, mailto ou tel.');
    }
  }
  function validateMedia(media, maxBytes = MAX_MEDIA_BYTES) {
    if (!isObject(media)) fail('Pièce jointe invalide.');
    if (media.remoteUrl !== undefined) {
      if (!safeUrl(media.remoteUrl) || !/^https?:/.test(media.remoteUrl)) fail('URL du média refusée.');
      if (media.dataUrl) fail('Un média distant ne doit pas être enregistré comme pièce jointe locale.');
      return true;
    }
    if (typeof media.dataUrl !== 'string') fail('Contenu de pièce jointe manquant.');
    const match = media.dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!match || !MEDIA_TYPES.includes(match[1]) || media.type !== match[1]) fail('Type de pièce jointe refusé ou incohérent (HTML et SVG actifs exclus).');
    if (match[2].length % 4 !== 0) fail('Pièce jointe base64 invalide.');
    const size = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (size > maxBytes || !Number.isFinite(media.size) || media.size !== size) fail('Taille de pièce jointe invalide ou supérieure à la limite autorisée.');
    let bytes;
    try { bytes = atob(match[2]); } catch { fail('Pièce jointe base64 invalide.'); }
    const validSignature = {
      'image/png': bytes.startsWith('\x89PNG\r\n\x1a\n'),
      'image/jpeg': bytes.startsWith('\xff\xd8\xff'),
      'image/gif': /^GIF8[79]a/.test(bytes),
      'image/webp': bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP',
      'image/bmp': bytes.startsWith('BM'), 'application/pdf': bytes.startsWith('%PDF-')
    };
    if (validSignature[media.type] === false) fail('Le contenu du fichier ne correspond pas à son type MIME.');
    return true;
  }
  function checkTree(value, depth = 0) {
    if (depth > 40) fail('JSON trop profondément imbriqué.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Nombre non fini refusé.');
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Propriété JSON interdite.');
      checkTree(value[key], depth + 1);
    }
  }
  function validateId(id) {
    if (typeof id !== 'string' || !/^[\p{L}\p{N}_.:@+-]{1,180}$/u.test(id)) fail('Identifiant absent ou invalide.');
  }
  function validateTimeline(timeline) {
    if (!isObject(timeline) || !Array.isArray(timeline.events) || typeof timeline.name !== 'string') fail('Chronologie invalide.');
    validateId(timeline.id);
    if (!['calendar', 'universal'].includes(timeline.timeMode)) fail('Mode temporel invalide.');
    if (timeline.events.length > 20000) fail('Limite de 20 000 événements par chronologie.');
    const ids = new Set();
    for (const event of timeline.events) {
      if (!isObject(event) || typeof event.title !== 'string' || !event.title.trim()) fail('Événement sans titre valide.');
      validateId(event.id);
      if (ids.has(event.id)) fail('Identifiant d’événement dupliqué.');
      ids.add(event.id);
      for (const key of ['kind', 'summary', 'markdown', 'links', 'sources', 'dateLabel', 'group', 'location'])
        if (event[key] !== undefined && typeof event[key] !== 'string') fail('Champ texte invalide : ' + key);
      if (event.color && !/^#[0-9a-f]{6}$/i.test(event.color)) fail('Couleur invalide.');
      if (!Array.isArray(event.tags) || event.tags.some(x => typeof x !== 'string') ||
          !Array.isArray(event.relations) || !Array.isArray(event.attachments)) fail('Liste d’événement invalide.');
      validateTemporal(event.time, timeline.timeMode);
      validateLinks(event.links || '');
      event.attachments.forEach(media=>validateMedia(media));
      if (event.externalIds !== undefined && (!isObject(event.externalIds) ||
          Object.values(event.externalIds).some(v => typeof v !== 'string' || /[\r\n]/.test(v)))) fail('Identifiant externe invalide.');
      if (event.icalRelations !== undefined && (!Array.isArray(event.icalRelations) ||
          event.icalRelations.some(r => !isObject(r) || typeof r.uid !== 'string' || /[\r\n]/.test(r.uid) ||
            !['PARENT', 'CHILD', 'SIBLING'].includes(r.type)))) fail('Relation iCalendar invalide.');
    }
    for (const event of timeline.events)
      if (event.relations.some(id => !ids.has(id) || id === event.id)) fail('Référence de relation absente ou circulaire vers soi-même.');
    return true;
  }
  function migrateState(input) {
    checkTree(input);
    if (!isObject(input) || ![1, 2].includes(input.version ?? 1) || !Array.isArray(input.timelines) || !input.timelines.length)
      fail('Projet V1/V2 invalide ou version non prise en charge.');
    const result = clone(input);
    result.version = 2;
    const timelineIds = new Set();
    for (const timeline of result.timelines) {
      timeline.unit = timeline.unit || 'cycle';
      if (!Array.isArray(timeline.events)) fail('Liste d’événements manquante.');
      for (const event of timeline.events) {
        if (!isObject(event)) fail('Événement invalide.');
        for (const key of ['group', 'location', 'sources']) if (event[key] === undefined) event[key] = '';
        if (typeof event.tags === 'string') event.tags = event.tags.split(',').map(x => x.trim()).filter(Boolean);
        if (event.tags === undefined) event.tags = [];
        if (event.relations === undefined) event.relations = [];
        if (event.attachments === undefined) event.attachments = [];
        // Réparation explicite du conteneur URI de V2, sans chargement distant.
        if (Array.isArray(event.attachments)) for (const media of event.attachments) {
          if (media.type === 'text/uri-list' && safeUrl(media.dataUrl || '') && /^https?:/.test(media.dataUrl)) {
            media.remoteUrl = media.dataUrl;
            delete media.dataUrl;
          }
        }
      }
      validateTimeline(timeline);
      if (timelineIds.has(timeline.id)) fail('Identifiant de chronologie dupliqué.');
      timelineIds.add(timeline.id);
    }
    if (!result.currentId) result.currentId = result.timelines[0].id;
    if (!timelineIds.has(result.currentId)) fail('Chronologie active introuvable.');
    return result;
  }
  function readNative(data) {
    checkTree(data);
    if (!isObject(data) || data.app !== 'Chronéa' || ![1, 2].includes(data.schemaVersion)) fail('Format Chronéa ou schemaVersion non pris en charge.');
    if (data.kind === 'project') return migrateState(data.state);
    if (!isObject(data.timeline)) fail('Chronologie manquante.');
    return migrateState({version: data.schemaVersion, currentId: data.timeline.id, timelines: [data.timeline]});
  }
  function csvCell(value = '', delimiter = ',') {
    const text = String(value ?? '');
    return text.includes(delimiter) || /["\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  const csvRows = (rows, delimiter = ',') => rows.map(row => row.map(v => csvCell(v, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
  function detectDelimiter(text) {
    const counts = {',': 0, ';': 0, '\t': 0};
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' && quoted && text[i + 1] === '"') { i++; continue; }
      if (c === '"') quoted = !quoted;
      if (!quoted && /[\r\n]/.test(c)) break;
      if (!quoted && c in counts) counts[c]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  function parseCSV(input, delimiter = null) {
    const text = input.replace(/^\uFEFF/, '');
    delimiter = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else cell += c;
      } else if (c === '"') {
        if (cell || closed) fail('Guillemet CSV inattendu.');
        quoted = true;
      } else if (c === delimiter) { row.push(cell); cell = ''; closed = false; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); if (row.some(v => v !== '')) rows.push(row);
        row = []; cell = ''; closed = false;
      } else {
        if (closed) fail('Texte après fermeture d’un champ CSV.');
        cell += c;
      }
    }
    if (quoted) fail('Champ CSV non terminé.');
    if (cell || row.length || closed) { row.push(cell); rows.push(row); }
    if (rows.length && rows.some(row => row.length !== rows[0].length)) fail('Nombre de colonnes CSV incohérent.');
    return rows;
  }
  function parseLooseDate(value = '') {
    const match = String(value).trim().match(/^(~)?(-?\d{1,10})(?:-(\d{1,2}|XX))?(?:-(\d{1,2}|XX))?$/);
    if (!match) { if (String(value).trim()) fail('Date non reconnue : ' + value); return null; }
    const result = {year: Number(match[2]), month: match[3] && match[3] !== 'XX' ? Number(match[3]) : '',
      day: match[4] && match[4] !== 'XX' ? Number(match[4]) : '', about: !!match[1]};
    validateDate(result.year, result.month, result.day);
    return result;
  }
  function parseEDTF(code = '') {
    code = String(code).trim();
    if (!code) return null;
    let certainty = 'exact', kind = 'point';
    if (code.startsWith('../')) { certainty = 'before'; code = code.slice(3); }
    else if (code.endsWith('/..')) { certainty = 'after'; code = code.slice(0, -3); }
    else if (code.includes('/')) kind = 'range';
    const values = code.split('/');
    if (values.length > 2) fail('Intervalle EDTF invalide.');
    let qualifier = null;
    const parts = value => {
      if (!value) return ['', '', ''];
      const m = value.match(/^(Y-?\d+|-?\d{4,10}|XXXX)(?:-(\d{2}|XX))?(?:-(\d{2}|XX))?([~?])?$/);
      if (!m) fail('EDTF non pris en charge : ' + value);
      if (m[4]) {
        const q = m[4] === '~' ? 'about' : 'uncertain';
        if (qualifier && qualifier !== q) fail('Précision distincte par borne : nécessite Schema v3.');
        qualifier = q;
      }
      return [m[1] === 'XXXX' ? '' : Number(m[1].replace(/^Y/, '')), m[2] && m[2] !== 'XX' ? Number(m[2]) : '', m[3] && m[3] !== 'XX' ? Number(m[3]) : ''];
    };
    const a = parts(values[0]), b = kind === 'range' ? parts(values[1]) : ['', '', ''];
    if (qualifier && ['before', 'after'].includes(certainty)) fail('Combinaison EDTF non représentable en V2.');
    const result = {certainty: qualifier || certainty, kind, startYear: a[0], startMonth: a[1], startDay: a[2], endYear: b[0], endMonth: b[1], endDay: b[2]};
    validateTemporal(result);
    return result;
  }
  const CSV_COLUMNS = ['id', 'title', 'type', 'time_mode', 'time_system_id', 'unit', 'temporal_kind',
    'date_edtf', 'calendar_start_year', 'calendar_start_month', 'calendar_start_day',
    'calendar_end_year', 'calendar_end_month', 'calendar_end_day', 'numeric_start', 'numeric_end',
    'qualifier', 'display_date', 'group', 'tags', 'location', 'summary', 'markdown', 'sources',
    'links', 'relations', 'color', 'ical_json', 'external_ids_json', 'ical_relations_json', 'timeline_unit'];
  function toCSV(timeline, edtf = () => '') {
    validateTimeline(timeline);
    const calendar = timeline.timeMode === 'calendar';
    const rows = [CSV_COLUMNS];
    for (const e of timeline.events) {
      const t = e.time || {};
      const values = {id: e.id, title: e.title, type: e.kind, time_mode: timeline.timeMode,
        time_system_id: calendar ? 'gregorian' : 'numeric', unit: t.unit || timeline.unit, timeline_unit: timeline.unit,
        temporal_kind: calendar ? t.kind || 'point' : hasValue(t.end) ? 'range' : 'point',
        date_edtf: calendar ? edtf(e) : '', numeric_start: calendar ? '' : t.start,
        numeric_end: calendar ? '' : t.end, qualifier: calendar ? t.certainty || 'exact' : t.qualifier || 'exact',
        display_date: e.dateLabel, group: e.group, tags: JSON.stringify(e.tags), location: e.location,
        summary: e.summary, markdown: e.markdown, sources: e.sources, links: e.links,
        relations: JSON.stringify(e.relations), color: e.color,
        ical_json: t.ical ? JSON.stringify(t.ical) : '', external_ids_json: e.externalIds ? JSON.stringify(e.externalIds) : '',
        ical_relations_json: e.icalRelations ? JSON.stringify(e.icalRelations) : ''};
      for (const prefix of ['start', 'end']) for (const component of ['year', 'month', 'day'])
        values['calendar_' + prefix + '_' + component] = calendar ? t[prefix + component[0].toUpperCase() + component.slice(1)] : '';
      rows.push(CSV_COLUMNS.map(key => values[key] ?? ''));
    }
    return '\uFEFF' + csvRows(rows);
  }
  function fromCSV(text, makeId, name = 'Import CSV') {
    const rows = parseCSV(text);
    if (rows.length < 2) fail('CSV sans événements.');
    const headers = rows[0].map(v => v.trim().toLowerCase());
    if (new Set(headers).size !== headers.length) fail('En-têtes CSV dupliqués.');
    const get = (row, ...keys) => { const index = keys.map(k => headers.indexOf(k)).find(i => i >= 0); return index === undefined ? '' : row[index]; };
    const modes = new Set(rows.slice(1).map(row => get(row, 'time_mode') || 'calendar'));
    if (modes.size !== 1) fail('Plusieurs modes temporels dans le même CSV : importe-les séparément.');
    const mode = [...modes][0];
    if (!['calendar', 'universal'].includes(mode)) fail('Mode temporel CSV inconnu.');
    const timeline = {id: makeId(), name, timeMode: mode, unit: get(rows[1], 'timeline_unit', 'unit') || 'cycle', events: []};
    const native = headers.includes('time_mode');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      try {
        const system = get(row, 'time_system_id');
        if (system && system !== (mode === 'calendar' ? 'gregorian' : 'numeric')) fail('Système temporel incompatible.');
        const title = get(row, 'title', 'event_name', 'name', 'headline');
        if (!title.trim()) fail('Titre manquant.');
        let time;
        if (mode === 'universal') time = {start: get(row, 'numeric_start'), end: get(row, 'numeric_end'), unit: get(row, 'unit'), qualifier: get(row, 'qualifier') || 'exact'};
        else if (headers.includes('calendar_start_year')) {
          time = {kind: get(row, 'temporal_kind') || 'point', certainty: get(row, 'qualifier') || 'exact'};
          for (const p of ['start', 'end']) for (const c of ['year', 'month', 'day'])
            time[p + c[0].toUpperCase() + c.slice(1)] = get(row, 'calendar_' + p + '_' + c);
        } else {
          time = parseEDTF(get(row, 'date_edtf', 'edtf'));
          if (!time) {
            const a = parseLooseDate(get(row, 'start_date', 'start', 'startdate'));
            const b = parseLooseDate(get(row, 'end_date', 'end', 'enddate'));
            time = {certainty: a?.about ? 'about' : 'exact', kind: b ? 'range' : 'point',
              startYear: a?.year ?? '', startMonth: a?.month ?? '', startDay: a?.day ?? '',
              endYear: b?.year ?? '', endMonth: b?.month ?? '', endDay: b?.day ?? ''};
          }
        }
        for (const key of ['start', 'end', 'startYear', 'startMonth', 'startDay', 'endYear', 'endMonth', 'endDay'])
          if (hasValue(time[key])) time[key] = number(time[key], key);
        if (get(row, 'ical_json')) time.ical = JSON.parse(get(row, 'ical_json'));
        const list = value => !value ? [] : value.startsWith('[') ? JSON.parse(value) : value.split('|').map(x => x.trim()).filter(Boolean);
        const now = new Date().toISOString();
        const event = {id: get(row, 'id', 'event_id') || makeId(), title, kind: get(row, 'type', 'kind') || 'Événement',
          createdAt: now, updatedAt: now, color: get(row, 'color') ? '#' + get(row, 'color').replace(/^#/, '') : '#925b39',
          group: get(row, 'group', 'layer', 'layer_name'), tags: list(get(row, 'tags', 'categories')),
          location: get(row, 'location', 'place'), dateLabel: get(row, 'display_date', 'date_label'),
          summary: get(row, 'summary', 'notes', 'description'), markdown: get(row, 'markdown', 'text'),
          links: get(row, 'links', 'url'), sources: get(row, 'sources', 'provenance'), time,
          attachments: [], relations: list(get(row, 'relations'))};
        if (get(row, 'external_ids_json')) event.externalIds = JSON.parse(get(row, 'external_ids_json'));
        if (get(row, 'ical_relations_json')) event.icalRelations = JSON.parse(get(row, 'ical_relations_json'));
        timeline.events.push(event);
      } catch (error) { fail('Ligne CSV ' + (i + 1) + ' : ' + error.message); }
    }
    const ids = new Map(timeline.events.map(e => [e.id, native ? e.id : makeId()]));
    if (ids.size !== timeline.events.length) fail('Identifiant CSV dupliqué.');
    for (const e of timeline.events) {
      e.id = ids.get(e.id);
      e.relations = e.relations.map(id => ids.get(id) || fail('Relation CSV non résolue : ' + id));
    }
    checkTree(timeline);
    validateTimeline(timeline);
    const supported = new Set([...CSV_COLUMNS, 'edtf', 'event_name', 'name', 'headline', 'start_date', 'end_date',
      'start', 'end', 'startdate', 'enddate', 'event_id', 'kind', 'layer', 'layer_name', 'categories', 'place',
      'date_label', 'notes', 'description', 'text', 'url', 'provenance']);
    return {timeline, ignoredColumns: headers.filter(h => !supported.has(h)), delimiter: detectDelimiter(text)};
  }
  const icsEscape = text => String(text).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const icsUnescape = text => String(text).replace(/\\([nN,;\\])/g, (_, c) => /[nN]/.test(c) ? '\n' : c);
  function splitICSTextList(value) {
    const list = [];
    let cell = '', escaped = false;
    for (const char of value) {
      if (escaped) { cell += char; escaped = false; }
      else if (char === '\\') { cell += char; escaped = true; }
      else if (char === ',') { list.push(icsUnescape(cell)); cell = ''; }
      else cell += char;
    }
    list.push(icsUnescape(cell));
    return list;
  }
  function foldICS(line) {
    let output = '', current = '', size = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (size + bytes > 75) { output += current + '\r\n'; current = ' '; size = 1; }
      current += char; size += bytes;
    }
    return output + current;
  }
  const icsParts = value => [Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8)),
    Number(value.slice(9, 11)), Number(value.slice(11, 13)), Number(value.slice(13, 15))];
  function validateICSDate(endpoint) {
    if (!isObject(endpoint) || !['DATE', 'DATE-TIME'].includes(endpoint.type) || typeof endpoint.value !== 'string') fail('Date iCalendar invalide.');
    const pattern = endpoint.type === 'DATE' ? /^\d{8}$/ : /^\d{8}T\d{6}Z?$/;
    if (!pattern.test(endpoint.value)) fail('Date iCalendar non reconnue.');
    const [y, m, d, h, min, sec] = icsParts(endpoint.value);
    if (y < 1 || y > 9999) fail('Année iCalendar hors plage 1–9999.');
    validateDate(y, m, d);
    if (endpoint.type === 'DATE-TIME' && (h > 23 || min > 59 || sec > 59)) fail('Horaire iCalendar invalide.');
    if (endpoint.tzid !== undefined) {
      if (typeof endpoint.tzid !== 'string' || /[\r\n:;"\\]/.test(endpoint.tzid) || endpoint.type === 'DATE' || endpoint.value.endsWith('Z')) fail('TZID incompatible.');
      try { new Intl.DateTimeFormat('en', {timeZone: endpoint.tzid}); } catch { fail('Fuseau horaire non pris en charge : ' + endpoint.tzid); }
    }
    return endpoint;
  }
  function utcMillis(parts) {
    const date = new Date(0);
    date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
    date.setUTCHours(parts[3] || 0, parts[4] || 0, parts[5] || 0, 0);
    return date.getTime();
  }
  function icsInstant(endpoint) {
    validateICSDate(endpoint);
    const parts = icsParts(endpoint.value), naive = utcMillis(parts);
    if (!endpoint.tzid) return naive;
    const formatter = new Intl.DateTimeFormat('en-GB', {timeZone: endpoint.tzid, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
    const localParts = instant => {
      const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
      return [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
    };
    let candidate = naive;
    for (let i = 0; i < 4; i++) candidate += naive - utcMillis(localParts(candidate));
    if (compareParts(localParts(candidate), parts) !== 0) fail('Horaire inexistant dans le fuseau (changement d’heure).');
    // RFC 5545 : première occurrence lors d'une heure répétée.
    for (const offset of [3600000, 1800000, 7200000])
      if (compareParts(localParts(candidate - offset), parts) === 0) candidate -= offset;
    return candidate;
  }
  function shiftICSDate(value, delta) {
    validateICSDate({type: 'DATE', value});
    const date = new Date(utcMillis(icsParts(value)));
    date.setUTCDate(date.getUTCDate() + delta);
    const year = date.getUTCFullYear();
    if (year < 1 || year > 9999) fail('Date iCalendar hors plage après conversion de la fin exclusive.');
    return String(year).padStart(4, '0') + String(date.getUTCMonth() + 1).padStart(2, '0') + String(date.getUTCDate()).padStart(2, '0');
  }
  function parseICSProperty(line) {
    let quoted = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      if (line[i] === ':' && !quoted) { colon = i; break; }
    }
    if (colon < 0) fail('Ligne iCalendar sans séparateur.');
    const head = line.slice(0, colon).split(/;(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
    const params = {};
    for (const item of head.slice(1)) {
      const equals = item.indexOf('=');
      if (equals < 1) fail('Paramètre iCalendar invalide.');
      const key = item.slice(0, equals).toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(key)) fail('Nom de paramètre iCalendar invalide.');
      if (Object.hasOwn(params, key)) fail('Paramètre iCalendar dupliqué.');
      params[key] = item.slice(equals + 1).replace(/^"(.*)"$/, '$1');
    }
    return {name: head[0].toUpperCase(), params, value: line.slice(colon + 1)};
  }
  function fromICS(text, makeId, name = 'iCalendar') {
    const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
    if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR') fail('Calendrier iCalendar incomplet.');
    const timeline = {id: makeId(), name, timeMode: 'calendar', unit: 'cycle', events: []};
    const uidMap = new Map(), warnings = new Set();
    let props = null;
    const componentStack = ['VCALENDAR'];
    const finish = () => {
      const one = key => {
        const values = props.filter(p => p.name === key);
        if (values.length > 1) fail('Propriété iCalendar dupliquée : ' + key);
        return values[0];
      };
      const endpoint = property => {
        if (!property) return null;
        const result = {value: property.value, type: (property.params.VALUE || 'DATE-TIME').toUpperCase()};
        if (property.params.TZID) result.tzid = property.params.TZID;
        validateICSDate(result);
        if (result.type === 'DATE-TIME') icsInstant(result);
        return result;
      };
      const start = endpoint(one('DTSTART')), end = endpoint(one('DTEND'));
      if (!start) fail('VEVENT sans DTSTART.');
      if (end && end.type !== start.type) fail('DTSTART/DTEND de types différents.');
      if (end && (!start.value.endsWith('Z') && !start.tzid) !== (!end.value.endsWith('Z') && !end.tzid)) fail('Mélange d’horaires flottants et zonés non pris en charge.');
      if (end && icsInstant(end) <= icsInstant(start)) fail('DTEND doit suivre DTSTART.');
      if (one('DURATION') || one('RRULE') || one('RDATE') || one('EXDATE') || one('RECURRENCE-ID'))
        fail('Durée ou récurrence iCalendar non prise en charge : exporte des occurrences explicites.');
      const a = icsParts(start.value), b = end ? icsParts(end.type === 'DATE' ? shiftICSDate(end.value, -1) : end.value) : null;
      const now = new Date().toISOString();
      const sourceUid = one('UID')?.value;
      if (!sourceUid || /[\r\n]/.test(sourceUid) || uidMap.has(sourceUid)) fail('UID iCalendar absent ou dupliqué.');
      const event = {id: makeId(), title: icsUnescape(one('SUMMARY')?.value || 'Événement'), kind: 'Événement',
        color: '#925b39', createdAt: now, updatedAt: now, group: '', tags: [], location: icsUnescape(one('LOCATION')?.value || ''),
        dateLabel: '', summary: '', markdown: icsUnescape(one('DESCRIPTION')?.value || ''), links: one('URL')?.value || '', sources: '',
        time: {certainty: 'exact', kind: b ? 'range' : 'point', startYear: a[0], startMonth: a[1], startDay: a[2],
          endYear: b?.[0] ?? '', endMonth: b?.[1] ?? '', endDay: b?.[2] ?? ''}, attachments: [], relations: [],
        externalIds: {icalUid: sourceUid}, icalRelations: props.filter(p => p.name === 'RELATED-TO').map(p =>
          ({uid: p.value, type: (p.params.RELTYPE || 'PARENT').toUpperCase()}))};
      event.tags = props.filter(p => p.name === 'CATEGORIES').flatMap(p => splitICSTextList(p.value));
      if (start.type === 'DATE-TIME') event.time.ical = {start, ...(end ? {end} : {})};
      uidMap.set(sourceUid, event.id);
      const supported = new Set(['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'URL', 'CATEGORIES', 'RELATED-TO']);
      props.filter(p => !supported.has(p.name)).forEach(p => warnings.add(p.name + ' omis'));
      timeline.events.push(event);
    };
    for (const line of lines.slice(1, -1)) {
      if (line.startsWith('BEGIN:')) {
        const component = line.slice(6);
        if (component === 'VEVENT') {
          if (componentStack.length !== 1) fail('VEVENT imbriqué dans un autre composant.');
          props = [];
        } else warnings.add(props ? 'Sous-composants (alarmes) omis' : 'Composants hors VEVENT omis');
        componentStack.push(component);
      } else if (line.startsWith('END:')) {
        const component = line.slice(4);
        if (componentStack.length === 1 || componentStack.at(-1) !== component) fail('Composant iCalendar mal fermé.');
        if (component === 'VEVENT') { finish(); props = null; }
        componentStack.pop();
      } else if (props && componentStack.at(-1) === 'VEVENT') props.push(parseICSProperty(line));
    }
    if (props || componentStack.length !== 1 || !timeline.events.length) fail('Calendrier sans événement complet.');
    for (const e of timeline.events) e.relations = [...new Set(e.icalRelations.filter(r => r.type === 'SIBLING')
      .map(r => uidMap.get(r.uid)).filter(id => id && id !== e.id))];
    validateTimeline(timeline);
    return {timeline, warnings: [...warnings]};
  }
  function calendarICS(y, m, d) {
    if (![y, m, d].every(hasValue) || y < 1 || y > 9999) return '';
    validateDate(y, m, d);
    return String(y).padStart(4, '0') + String(m).padStart(2, '0') + String(d).padStart(2, '0');
  }
  function toICS(timeline, now = new Date()) {
    validateTimeline(timeline);
    if (timeline.timeMode !== 'calendar') fail('iCalendar ne représente pas un axe imaginaire.');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chronea//2.1//FR', 'CALSCALE:GREGORIAN'];
    let skipped = 0;
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uids = new Map(timeline.events.map(e => [e.id, e.externalIds?.icalUid || e.id + '@chronea.local']));
    const endpointLine = (key, endpoint) => key + ';VALUE=' + endpoint.type +
      (endpoint.tzid ? ';TZID=' + endpoint.tzid : '') + ':' + endpoint.value;
    for (const e of timeline.events) {
      const t = e.time || {}, start = calendarICS(t.startYear, t.startMonth, t.startDay);
      const end = t.kind === 'range' ? calendarICS(t.endYear, t.endMonth, t.endDay) : '';
      if (!start || (t.certainty || 'exact') !== 'exact' || (t.kind === 'range' && !end) ||
          (!t.ical && end === '99991231')) { skipped++; continue; }
      lines.push('BEGIN:VEVENT', 'UID:' + uids.get(e.id), 'DTSTAMP:' + stamp);
      if (t.ical) {
        lines.push(endpointLine('DTSTART', t.ical.start));
        if (t.ical.end) lines.push(endpointLine('DTEND', t.ical.end));
      } else {
        lines.push('DTSTART;VALUE=DATE:' + start);
        if (end) lines.push('DTEND;VALUE=DATE:' + shiftICSDate(end, 1));
      }
      lines.push('SUMMARY:' + icsEscape(e.title));
      const description = [e.summary, e.markdown, e.sources ? 'Sources: ' + e.sources : ''].filter(Boolean).join('\n\n');
      if (description) lines.push('DESCRIPTION:' + icsEscape(description));
      if (e.location) lines.push('LOCATION:' + icsEscape(e.location));
      const categories = [e.group, ...e.tags].filter(Boolean);
      if (categories.length) lines.push('CATEGORIES:' + categories.map(icsEscape).join(','));
      const link = (e.links || '').split('\n').filter(Boolean)[0];
      if (link) lines.push('URL:' + safeUrl(link.split('|').at(-1).trim()));
      const relations = [...(e.icalRelations || [])];
      for (const id of e.relations) if (!relations.some(r => r.uid === uids.get(id) && r.type === 'SIBLING'))
        relations.push({uid: uids.get(id), type: 'SIBLING'});
      for (const r of relations) lines.push('RELATED-TO;RELTYPE=' + r.type + ':' + r.uid);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return {text: lines.map(foldICS).join('\r\n') + '\r\n', skipped};
  }
  return {MAX_IMPORT_BYTES, MAX_MEDIA_BYTES, MEDIA_TYPES, hasValue, leapYear, daysInMonth,
    validateDate, dateBounds, validateTemporal, safeUrl, validateLinks, validateMedia,
    validateTimeline, migrateState, readNative, checkTree, csvCell, csvRows, parseCSV,
    detectDelimiter, parseLooseDate, parseEDTF, toCSV, fromCSV, foldICS, icsEscape,
    icsUnescape, validateICSDate, icsInstant, shiftICSDate, fromICS, toICS};
})();
