/* Tests du noyau exécutés dans un contexte JS isolé, sans dépendre de l'UI. */
(() => {
  const C = ChroneaCore, results = [];
  const assert = (condition, message = 'Assertion échouée') => { if (!condition) throw new Error(message); };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const equal = (a, b) => assert(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), JSON.stringify({actual: a, expected: b}));
  const rejects = fn => { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, 'Valeur invalide acceptée'); };
  const test = (name, fn) => { try { fn(); results.push({name, ok: true}); } catch (e) { results.push({name, ok: false, error: e.message}); } };
  let sequence = 0;
  const id = () => 'test-' + ++sequence;
  const event = (time = {startYear: 2012, certainty: 'exact', kind: 'point'}) => ({id: id(), title: 'Repère',
    kind: 'Souvenir', color: '#925b39', group: 'Mémoire', tags: ['été', 'mot|avec séparateur'], location: 'Lac',
    dateLabel: '', summary: 'Virgule, point-virgule; et "citation"\nNouvelle ligne', markdown: '**Texte**',
    sources: 'Carnet', links: 'Archive | https://example.org/archive', time, attachments: [], relations: []});
  const timeline = (mode = 'calendar', events = [event()]) => ({id: id(), name: 'Mémoire', timeMode: mode, unit: 'cycle', events});
  const ics = (start, end = '', extra = '', uid = 'original@example.org') =>
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:' + uid + '\r\nSUMMARY:Midi\r\n' + start + '\r\n' +
    (end ? end + '\r\n' : '') + extra + 'END:VEVENT\r\nEND:VCALENDAR\r\n';
  test('31 février 2024 refusé', () => rejects(() => C.validateDate(2024, 2, 31)));
  test('29 février 2024 accepté', () => C.validateDate(2024, 2, 29));
  test('29 février 2023 refusé', () => rejects(() => C.validateDate(2023, 2, 29)));
  test('1900 non bissextile, 2000 bissextile', () => { assert(!C.leapYear(1900)); assert(C.leapYear(2000)); });
  test('Mois et jours hors plage refusés', () => {
    for (const args of [[2024, 0, 1], [2024, 13, 1], [2024, 4, 31], [2024, 1, 0], [2024, 2, 1.5]]) rejects(() => C.validateDate(...args));
  });
  test('NaN, Infinity, année fractionnaire refusés', () => {
    for (const year of [NaN, Infinity, 2012.5, '  ', true, {}, 1e12]) rejects(() => C.validateDate(year));
  });
  test('Le rendu ne corrige pas une date invalide', () => rejects(() => C.dateBounds(2024, 2, 31)));
  test('Année seule : plage annuelle et aucun faux jour', () => {
    const t = {startYear: 2012}; C.validateTemporal(t); equal(C.dateBounds(2012), {min: 2012, max: 2013, anchor: 2012.5, precision: 'year'}); equal(t, {startYear: 2012});
  });
  test('Mois seul et jour sans mois restent partiels', () => {
    equal(C.dateBounds(2012, 7).precision, 'month'); equal(C.dateBounds(2012, '', 15).precision, 'partial'); C.validateDate('', 2, 29);
  });
  test('Période inversée refusée', () => rejects(() => C.validateTemporal({kind: 'range', startYear: 2025, endYear: 2020})));
  test('Période partielle et chevauchement de précision acceptés', () => C.validateTemporal({kind: 'range', startYear: 2024, startMonth: 7, endYear: 2024}));
  test('Point avec fin et intervalle incomplet refusés', () => {
    rejects(() => C.validateTemporal({kind: 'point', startYear: 2024, endYear: 2025}));
    rejects(() => C.validateTemporal({kind: 'range', startYear: 2024}));
  });
  test('Avant/après : repère ouvert cohérent', () => {
    C.validateTemporal({kind: 'point', certainty: 'before', startYear: 1980});
    C.validateTemporal({kind: 'point', certainty: 'after', startYear: 1975});
    rejects(() => C.validateTemporal({kind: 'range', certainty: 'before', startYear: 1975, endYear: 1980}));
  });
  test('Axe numérique décimal négatif accepté, valeurs non finies refusées', () => {
    C.validateTemporal({start: -12.5, end: 12, unit: 'cycle'}, 'universal');
    for (const start of [Infinity, NaN, 'nope']) rejects(() => C.validateTemporal({start}, 'universal'));
    rejects(() => C.validateTemporal({start: 12, end: 10}, 'universal'));
  });
  test('EDTF approximation, incertitude, années négatives et étendues', () => {
    equal(C.parseEDTF('2012~').certainty, 'about'); equal(C.parseEDTF('2012?').certainty, 'uncertain');
    equal(C.parseEDTF('-0044-03-15').startYear, -44); equal(C.parseEDTF('Y12000').startYear, 12000);
  });
  test('EDTF ouvert et composant inconnu', () => {
    equal(C.parseEDTF('../1980').certainty, 'before'); equal(C.parseEDTF('1975/..').certainty, 'after');
    equal(C.parseEDTF('2012-XX-15').startDay, 15); equal(C.parseEDTF('XXXX-02-29').startYear, '');
  });
  test('EDTF impossible ou non représentable refusé', () => {
    for (const value of ['2024-02-31', '2025/2020', '2012/2013/2014', '2012~/2013?', '2012-foo']) rejects(() => C.parseEDTF(value));
  });
  test('CSV virgule, point-virgule, tabulation, BOM et champs cités', () => {
    for (const delimiter of [',', ';', '\t']) equal(C.parseCSV('\uFEFF' + C.csvRows([['title', 'notes'], ['Été', 'a,b;c\t"d"\nligne']], delimiter)), [['title', 'notes'], ['Été', 'a,b;c\t"d"\nligne']]);
  });
  test('CSV malformé refusé', () => {
    for (const value of ['a,b\n"a,b', 'a,b\na,b,c', 'a,b\n"a"x,b']) rejects(() => C.parseCSV(value));
  });
  test('cycle 12 CSV round-trip conserve mode/unité/valeurs/IDs/relations', () => {
    const a = event({start: 12, end: 18.5, unit: 'lune', qualifier: 'about'}), b = event({start: 20, qualifier: 'exact'});
    a.relations = [b.id]; b.relations = [a.id];
    const t = timeline('universal', [a, b]);
    const imported = C.fromCSV(C.toCSV(t), id).timeline;
    equal(imported.timeMode, 'universal'); equal(imported.unit, 'cycle'); equal(imported.events[0].time.start, 12);
    equal(imported.events[0].time.unit, 'lune'); equal(imported.events[0].time.qualifier, 'about');
    equal(imported.events.map(e => e.id), t.events.map(e => e.id)); equal(imported.events[0].relations, a.relations);
    equal(imported.events[0].tags, a.tags); equal(imported.events[0].summary, a.summary);
  });
  test('CSV calendrier conserve dates partielles et qualificatifs', () => {
    const t = timeline('calendar', [event({startYear: -44, startMonth: '', startDay: '', kind: 'point', certainty: 'uncertain'})]);
    const time = C.fromCSV(C.toCSV(t), id).timeline.events[0].time;
    equal(time.startYear, -44); equal(time.startMonth, ''); equal(time.startDay, ''); equal(time.certainty, 'uncertain'); equal(time.kind, 'point');
  });
  test('CSV générique remappe les IDs et les relations', () => {
    const result = C.fromCSV('event_id;event_name;start_date;relations;unused\na;A;2012;b;x\nb;B;2013;a;y\n', id);
    assert(result.timeline.events[0].id !== 'a'); equal(result.timeline.events[0].relations, [result.timeline.events[1].id]); equal(result.ignoredColumns, ['unused']);
  });
  test('CSV date invalide, mode mixte et IDs dupliqués refusés', () => {
    for (const value of ['title,start_date\nA,2024-02-31', 'title,time_mode,numeric_start\nA,universal,12\nB,calendar,13', 'id,title,start_date\na,A,2012\na,B,2013']) rejects(() => C.fromCSV(value, id));
  });
  test('ICS all-day : DTEND exclusif devient fin inclusive', () => {
    const t = C.fromICS(ics('DTSTART;VALUE=DATE:20240918', 'DTEND;VALUE=DATE:20240919'), id).timeline;
    equal(t.events[0].time.endDay, 18); assert(C.toICS(t).text.includes('DTEND;VALUE=DATE:20240919'));
  });
  test('ICS horaire 12h → 13h reste sur la même journée', () => {
    const t = C.fromICS(ics('DTSTART:20240918T120000Z', 'DTEND:20240918T130000Z'), id).timeline;
    equal(t.events[0].time.endDay, 18); equal(t.events[0].time.ical.end.value, '20240918T130000Z');
    const round = C.fromICS(C.toICS(t).text, id).timeline;
    equal(round.events[0].time, t.events[0].time); equal(round.events[0].externalIds.icalUid, 'original@example.org');
  });
  test('ICS TZID et UTC : instants connus équivalents', () => {
    const zone = {type: 'DATE-TIME', value: '20240918T120000', tzid: 'Europe/Paris'};
    equal(C.icsInstant(zone), C.icsInstant({type: 'DATE-TIME', value: '20240918T100000Z'}));
    const t = C.fromICS(ics('DTSTART;TZID="Europe/Paris":20240918T120000', 'DTEND;TZID=Europe/Paris:20240918T130000'), id).timeline;
    assert(C.toICS(t).text.includes('TZID=Europe/Paris')); equal(t.events[0].time.ical.start.tzid, 'Europe/Paris');
  });
  test('ICS heure locale libre préservée', () => {
    const t = C.fromICS(ics('DTSTART:20240918T120000', 'DTEND:20240918T130000'), id).timeline;
    equal(t.events[0].time.ical.start, {type: 'DATE-TIME', value: '20240918T120000'});
    assert(C.toICS(t).text.includes('DTSTART;VALUE=DATE-TIME:20240918T120000\r\n'));
  });
  test('ICS année 0099 et fin de mois', () => {
    equal(C.shiftICSDate('00990228', 1), '00990301'); equal(C.shiftICSDate('20240229', 1), '20240301');
  });
  test('ICS changement d’heure : heure inexistante refusée, première occurrence retenue', () => {
    rejects(() => C.icsInstant({type: 'DATE-TIME', value: '20240331T023000', tzid: 'Europe/Paris'}));
    equal(C.icsInstant({type: 'DATE-TIME', value: '20241027T023000', tzid: 'Europe/Paris'}), Date.parse('2024-10-27T00:30:00Z'));
  });
  test('ICS dates invalides, type incohérent et période inversée refusés', () => {
    for (const value of [ics('DTSTART;VALUE=DATE:20240231'), ics('DTSTART:20240918T250000Z'),
      ics('DTSTART;VALUE=DATE:20240918', 'DTEND:20240919T130000Z'),
      ics('DTSTART:20240918T130000Z', 'DTEND:20240918T120000Z')]) rejects(() => C.fromICS(value, id));
  });
  test('ICS fuseau inconnu et récurrence refusés explicitement', () => {
    rejects(() => C.fromICS(ics('DTSTART;TZID=Unknown/Mars:20240918T120000'), id));
    rejects(() => C.fromICS(ics('DTSTART;VALUE=DATE:20240918', '', 'RRULE:FREQ=DAILY\r\n'), id));
  });
  test('ICS composants mal fermés ou événements imbriqués refusés', () => {
    rejects(() => C.fromICS(ics('DTSTART;VALUE=DATE:20240918', '', 'BEGIN:VALARM\r\nEND:VTODO\r\n'), id));
    rejects(() => C.fromICS('BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20240918\r\nEND:VEVENT\r\nEND:VTODO\r\nEND:VCALENDAR', id));
  });
  test('ICS échappement Unicode et repli UTF-8 <= 75 octets', () => {
    const text = 'é🌿,;\\\n'.repeat(40);
    equal(C.icsUnescape(C.icsEscape(text)), text);
    const folded = C.foldICS('DESCRIPTION:' + C.icsEscape(text));
    assert(folded.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
    equal(folded.replace(/\r\n /g, ''), 'DESCRIPTION:' + C.icsEscape(text));
  });
  test('ICS catégories avec virgule, backslash final et propriétés répétées', () => {
    const t = timeline('calendar', [event({startYear: 2024, startMonth: 9, startDay: 18})]);
    t.events[0].group = ''; t.events[0].tags = ['fin\\', 'virgule,interne', 'suivant'];
    equal(C.fromICS(C.toICS(t).text, id).timeline.events[0].tags, t.events[0].tags);
    equal(C.fromICS(ics('DTSTART;VALUE=date:20240918', '', 'CATEGORIES:A\\,B\r\nCATEGORIES:C\r\n'), id).timeline.events[0].tags, ['A,B', 'C']);
  });
  test('ICS RELATED-TO directionnel et UID sont préservés', () => {
    const input = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
      'BEGIN:VEVENT\r\nUID:a@ext\r\nDTSTART;VALUE=DATE:20240918\r\nRELATED-TO;RELTYPE=PARENT:b@ext\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:b@ext\r\nDTSTART;VALUE=DATE:20240919\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const t = C.fromICS(input, id).timeline;
    equal(t.events[0].relations, []); equal(t.events[1].relations, []);
    assert(C.toICS(t).text.includes('RELATED-TO;RELTYPE=PARENT:b@ext'));
  });
  test('ICS dates vagues, partielles et fin partielle omises honnêtement', () => {
    const t = timeline('calendar', [event(), event({startYear: 2012, startMonth: 7, startDay: 12, certainty: 'about'}),
      event({kind: 'range', startYear: 2012, startMonth: 7, startDay: 12, endYear: 2013})]);
    equal(C.toICS(t).skipped, 3);
  });
  test('Native V2 round-trip sans perte : médias et relations', () => {
    const a = event(), b = event({startYear: 2024, startMonth: 2, startDay: 29}); a.relations = [b.id]; b.relations = [a.id];
    const payload = btoa('%PDF-1.4\nfixture'); a.attachments = [{id: id(), name: 'source.pdf', type: 'application/pdf', size: atob(payload).length, dataUrl: 'data:application/pdf;base64,' + payload}];
    const t = timeline('calendar', [a, b]);
    const state = {version: 2, currentId: t.id, timelines: [t], prefs: {theme: 'night'}};
    equal(C.readNative(JSON.parse(JSON.stringify({app: 'Chronéa', schemaVersion: 2, kind: 'project', state}))), state);
  });
  test('Migration V1 → V2 ne modifie pas sa source', () => {
    const e = event(); delete e.group; delete e.tags; delete e.location; delete e.sources;
    const t = timeline('calendar', [e]), state = {version: 1, currentId: t.id, timelines: [t]};
    const before = JSON.stringify(state), migrated = C.migrateState(state);
    equal(JSON.stringify(state), before); equal(migrated.version, 2); equal(migrated.timelines[0].events[0].tags, []);
  });
  test('Native version future, références cassées et prototype refusés', () => {
    const t = timeline(); rejects(() => C.readNative({app: 'Chronéa', schemaVersion: 3, timeline: t}));
    t.events[0].relations = ['missing']; rejects(() => C.validateTimeline(t));
    rejects(() => C.checkTree(JSON.parse('{"__proto__":{"polluted":true}}')));
  });
  test('URL javascript, data, file et relative refusées', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', '/relative', 'java\nscript:alert(1)']) equal(C.safeUrl(value), '');
    assert(C.safeUrl('https://example.org')); rejects(() => C.validateLinks('Piège | javascript:alert(1)'));
  });
  test('Médias : MIME, taille, contenu actif et fausse image refusés', () => {
    for (const media of [{type: 'image/svg+xml', size: 0, dataUrl: 'data:image/svg+xml;base64,'},
      {type: 'image/png', size: 4, dataUrl: 'data:image/png;base64,' + btoa('fake')},
      {type: 'text/plain', size: 5, dataUrl: 'data:text/plain;base64,' + btoa('four')},
      {type: 'text/uri-list', size: 0, remoteUrl: 'javascript:alert(1)'}]) rejects(() => C.validateMedia(media));
    C.validateMedia({type: 'text/plain', size: 4, dataUrl: 'data:text/plain;base64,' + btoa('four')});
  });
  test('V2 ancien média distant migré sans chargement et sans fausse Data URL', () => {
    const t = timeline(); t.events[0].attachments = [{id: id(), name: 'Média', type: 'text/uri-list', size: 0, dataUrl: 'https://example.org/photo.jpg'}];
    const e = C.migrateState({version: 2, currentId: t.id, timelines: [t]}).timelines[0].events[0];
    equal(e.attachments[0].remoteUrl, 'https://example.org/photo.jpg'); assert(!e.attachments[0].dataUrl);
  });
  return results;
})()
