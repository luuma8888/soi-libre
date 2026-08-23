// Ce fichier source est injecté tel quel dans les deux distributions HTML.
const BoussoleRuntimeProvider = {
  cacheDatabase: "boussole-pro-runtime-v1",
  cacheStore: "validated-bundles",
  cacheKey: "latest-complete-runtime",

  async load(options = {}) {
    if (REFONTE_DATA.embeddedRuntime) {
      await this.validateBundle(REFONTE_DATA.embeddedRuntime, true);
      return { dataset: this.adapt(REFONTE_DATA.embeddedRuntime), mode: "offline_embedded", manifest: REFONTE_DATA.embeddedRuntime.manifest, warning: "" };
    }
    try {
      const bundle = await this.loadNetwork(options.forceNetwork);
      if (bundle.complete) await this.writeCache(bundle);
      return {
        dataset: this.adapt(bundle),
        mode: bundle.complete ? "external_runtime" : "external_runtime_without_market",
        manifest: bundle.manifest,
        warning: bundle.complete ? "" : "Les repères marché sont temporairement indisponibles ; ils ne modifient pas le classement personnel."
      };
    } catch (networkError) {
      const cached = await this.readCache();
      if (!cached) throw new Error(`Chargement des données impossible : ${networkError.message}`);
      await this.validateBundle(cached, true);
      return { dataset: this.adapt(cached), mode: "validated_cache", manifest: cached.manifest, warning: "Données chargées depuis la dernière combinaison intégralement validée sur cet appareil." };
    }
  },

  async loadNetwork(forceNetwork = false) {
    const base = new URL(REFONTE_DATA.runtimeBasePath, document.baseURI);
    const response = await fetch(new URL("boussole-runtime-manifest.json", base), { cache: forceNetwork ? "reload" : "no-store" });
    if (!response.ok) throw new Error(`manifeste HTTP ${response.status}`);
    const manifest = await response.json();
    this.validateManifest(manifest);
    const core = await this.fetchProjection(base, manifest.files.core, forceNetwork);
    this.validateCore(core, manifest);
    const competencesPromise = this.fetchProjection(base, manifest.files.competences, forceNetwork);
    const marchePromise = this.fetchProjection(base, manifest.files.marche, forceNetwork).catch(() => null);
    const competences = await competencesPromise;
    this.validateCompetences(competences, core, manifest);
    const marche = await marchePromise;
    const complete = Boolean(marche);
    const effectiveMarket = marche || this.unavailableMarket(core, manifest);
    this.validateMarket(effectiveMarket, core, manifest);
    const bundle = { manifest, core, competences, marche: effectiveMarket, complete };
    await this.validateBundle(bundle, complete);
    return bundle;
  },

  async fetchProjection(base, descriptor, forceNetwork) {
    const response = await fetch(new URL(descriptor.path, base), { cache: forceNetwork ? "reload" : "default" });
    if (!response.ok) throw new Error(`${descriptor.path} HTTP ${response.status}`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength !== descriptor.bytes) throw new Error(`${descriptor.path} : taille incohérente`);
    if (await this.sha256(text) !== descriptor.sha256) throw new Error(`${descriptor.path} : empreinte incohérente`);
    return JSON.parse(text);
  },

  validateManifest(manifest) {
    if (manifest?.schemaVersion !== "1.0.0" || !manifest.datasetVersion || !manifest.generatedAt) throw new Error("Manifeste runtime invalide.");
    if (Number(manifest.counts?.jobs) !== 1000) throw new Error("Le manifeste ne déclare pas exactement 1 000 métiers.");
    for (const key of ["core", "competences", "marche"]) {
      const file = manifest.files?.[key];
      if (!file?.path || !/^[a-f0-9]{64}$/.test(file.sha256 || "") || !Number.isFinite(file.bytes)) throw new Error(`Descripteur ${key} invalide.`);
    }
  },

  validateCore(core, manifest) {
    const jobs = Array.isArray(core?.jobs) ? core.jobs : [];
    const codes = jobs.map(job => job.romeCode);
    if (core?.schemaVersion !== manifest.schemaVersion || core?.datasetVersion !== manifest.datasetVersion || core?.generatedAt !== manifest.generatedAt) throw new Error("Identité du core incohérente.");
    if (jobs.length !== 1000 || new Set(codes).size !== 1000 || codes.some(code => !/^[A-Z][0-9]{4}$/.test(code || ""))) throw new Error("Corpus core invalide.");
  },

  validateCompetences(data, core, manifest) {
    if (data?.schemaVersion !== manifest.schemaVersion || data?.datasetVersion !== manifest.datasetVersion || data?.generatedAt !== manifest.generatedAt) throw new Error("Identité des compétences incohérente.");
    const jobIds = new Set(core.jobs.map(job => job.id));
    const itemIds = new Set((data.items || []).map(item => item.id));
    const groupIds = new Set((data.groups || []).map(group => group.id));
    if ((data.jobs || []).length !== jobIds.size) throw new Error("Relations métier-compétence incomplètes.");
    for (const relation of data.jobs || []) {
      if (!jobIds.has(relation.jobId)) throw new Error(`Métier orphelin : ${relation.jobId}`);
      for (const id of [...(relation.requiredSkillIds || []), ...(relation.optionalSkillIds || []), ...(relation.softSkillIds || []), ...(relation.knowledgeIds || [])]) if (!itemIds.has(id)) throw new Error(`Compétence ou savoir orphelin : ${id}`);
      for (const group of relation.skillGroups || []) {
        if (!groupIds.has(group.groupId)) throw new Error(`Groupe orphelin : ${group.groupId}`);
        for (const id of group.skillIds || []) if (!itemIds.has(id)) throw new Error(`Compétence de groupe orpheline : ${id}`);
      }
    }
  },

  validateMarket(data, core, manifest) {
    if (data?.schemaVersion !== manifest.schemaVersion || data?.datasetVersion !== manifest.datasetVersion || data?.generatedAt !== manifest.generatedAt) throw new Error("Identité du marché incohérente.");
    if ((data.jobs || []).length !== core.jobs.length) throw new Error("Relations métier-marché incomplètes.");
    if (Object.keys(data.territories || {}).join("|") !== "FR|REG-76|DEP-11") throw new Error("Territoires marché incohérents.");
  },

  async validateBundle(bundle, verifyHashes = false) {
    this.validateManifest(bundle.manifest);
    this.validateCore(bundle.core, bundle.manifest);
    this.validateCompetences(bundle.competences, bundle.core, bundle.manifest);
    this.validateMarket(bundle.marche, bundle.core, bundle.manifest);
    if (!verifyHashes) return;
    for (const [key, value] of [["core", bundle.core], ["competences", bundle.competences], ["marche", bundle.marche]]) {
      const text = JSON.stringify(value);
      const descriptor = bundle.manifest.files[key];
      if (new TextEncoder().encode(text).byteLength !== descriptor.bytes || await this.sha256(text) !== descriptor.sha256) throw new Error(`Cache ${key} incohérent.`);
    }
  },

  unavailableMarket(core, manifest) {
    const unavailable = () => ({ availability: "unavailable", offersCount: null, offersLevel: "unknown", territorialSignal: "unknown", tensionClass: null, tensionLevel: "unknown", tensionImputed: false, recruitmentDifficultyRate: null, statisticalScope: "unknown", sharedFamily: false, confidence: 0 });
    return {
      schemaVersion: manifest.schemaVersion,
      datasetVersion: manifest.datasetVersion,
      generatedAt: manifest.generatedAt,
      vintages: { offers: null, bmo: null, daresTension: null },
      territories: { FR: "France", "REG-76": "Occitanie", "DEP-11": "Aude" },
      jobs: core.jobs.map(job => ({ jobId: job.id, territories: { FR: unavailable(), "REG-76": unavailable(), "DEP-11": unavailable() } }))
    };
  },

  adapt(bundle) {
    const { core, competences, marche, manifest } = bundle;
    const relations = new Map((competences.jobs || []).map(item => [item.jobId, item]));
    const marketRows = new Map((marche.jobs || []).map(item => [item.jobId, item]));
    const groups = new Map((competences.groups || []).map(item => [item.id, item.label]));
    const contexts = new Map((core.workContexts || []).map(item => [item.id, item]));
    const grandDomains = new Map((core.dictionaries?.romeGrandDomains || []).map(item => [item.code, item.label]));
    const professionalDomains = new Map((core.dictionaries?.romeProfessionalDomains || []).map(item => [item.code, item.label]));
    const accessWarnings = new Map((core.dictionaries?.accessWarnings || []).map(item => [item.id, item.label]));
    const skills = (competences.items || []).filter(item => item.type !== "knowledge").map(item => ({ id: item.id, label: item.label, classification: item.type, type: item.type, aliases: item.aliases || [] }));
    const skillLabels = new Map(skills.map(item => [item.id, item.label]));
    const knowledge = (competences.items || []).filter(item => item.type === "knowledge").map(item => ({ id: item.id, label: item.label, type: "knowledge", classification: "knowledge" }));
    const jobs = core.jobs.map(job => {
      const relation = relations.get(job.id) || {};
      const required = relation.requiredSkillIds || [];
      const optional = relation.optionalSkillIds || [];
      const soft = relation.softSkillIds || [];
      const knowledgeIds = relation.knowledgeIds || [];
      const displayed = (relation.skillGroups || []).flatMap(group => group.skillIds || []);
      const constraints = this.expandConstraints(job.constraints, contexts);
      return {
        ...job,
        canonicalId: job.id,
        schemaVersion: "1.0.0",
        provenance: "generated_rome",
        romeGrandDomainLabel: grandDomains.get(job.romeGrandDomainCode) || null,
        romeProfessionalDomainLabel: professionalDomains.get(job.romeProfessionalDomainCode) || null,
        domain: job.domain,
        family: job.family || job.domain,
        sourceDomain: job.domain,
        sourceFamily: job.family || job.domain,
        appellations: job.appellations || [],
        boussoleSectorIds: job.boussoleSectorIds || [],
        secondarySectorIds: job.secondarySectorIds || [],
        interestTags: job.interestTags || [],
        valueTags: job.valueTags || [],
        transitionTags: job.transitionTags || [],
        workContexts: job.workContexts || [],
        romeWorkContextLabels: (job.workContexts || []).map(id => contexts.get(id)?.label).filter(Boolean),
        missingFields: job.missingFields || [],
        activities: [],
        accessConditions: { text: null, source: "compact_structured_runtime", confidence: job.accessSummary?.confidence || 0 },
        accessSummary: this.expandAccess(job.accessSummary, job.accessPaths, core.diplomaLevels, accessWarnings),
        accessPaths: job.accessPaths || [],
        skillGroups: (relation.skillGroups || []).map(group => ({ issueId: group.groupId, issueLabel: groups.get(group.groupId) || group.groupId, skills: group.skillIds || [] })),
        requiredSkills: required,
        matchableSkillIds: required,
        scorableSkillIds: required,
        optionalSkills: optional,
        softSkillIds: soft,
        softSkills: soft,
        mobilizedSkillIds: [...new Set([...displayed, ...required, ...optional, ...soft])],
        romeSkillLabels: {
          required: required.map(id => skillLabels.get(id)).filter(Boolean),
          optional: optional.map(id => skillLabels.get(id)).filter(Boolean),
          soft: soft.map(id => skillLabels.get(id)).filter(Boolean)
        },
        knowledgeIds,
        knowledge: knowledgeIds,
        constraints: constraints.constraints,
        physicalConstraints: constraints.physicalConstraints,
        scheduleConstraints: constraints.scheduleConstraints,
        mobilityConstraints: constraints.mobilityConstraints,
        officialConstraintSummary: constraints.officialConstraintSummary,
        publicContactLevel: job.constraints?.publicContactLevel || "unknown",
        autonomyLevel: job.constraints?.autonomyLevel || "unknown",
        remoteCompatibility: job.constraints?.remoteCompatibility || "unknown",
        requiredDiplomaLevel: null,
        recommendedDiplomaLevel: null,
        requiredCertifications: [],
        recommendedCertifications: [],
        relatedJobs: [],
        market: { status: "unknown", source: "unknown", confidence: 0 },
        marketIndicators: [],
        marketStats: this.expandMarket(marketRows.get(job.id), marche)
      };
    });
    return {
      schemaVersion: core.schemaVersion,
      datasetName: "Boussole Pro - runtime compact ROME1000",
      datasetVersion: core.datasetVersion,
      sourceDate: core.sourceDate,
      importedAt: core.generatedAt,
      provenance: "generated_rome",
      confidence: 0.75,
      jobs,
      skills,
      skillsEngine: skills,
      matchableSkills: skills.filter(item => item.classification === "skill_action"),
      knowledge,
      workContexts: (core.workContexts || []).map(item => ({ ...item, constraintTags: item.constraintTags || [] })),
      jobAppellations: [],
      diplomaLevels: core.diplomaLevels || [],
      marketTrends: { schemaVersion: marche.schemaVersion, generatedAt: marche.generatedAt, jobs: [] },
      runtimeBundleIdentity: { inputMode: "compact_runtime_v1", runtimeBundleRevision: core.datasetVersion, fingerprintSha256: manifest.runtimeFingerprintSha256, sourceDatasetVersion: core.datasetVersion, status: "validated_compact_runtime", counts: { jobs: jobs.length, skillsEngine: skills.length, knowledge: knowledge.length } }
    };
  },

  expandAccess(summary, paths, diplomaLevels, warningLabels = new Map()) {
    if (!summary) return null;
    const labels = new Map((diplomaLevels || []).map(item => [Number(item.level), item.label]));
    return { ...summary, warnings: (summary.warnings || []).map(id => warningLabels.get(id) || id), minimumDiplomaLabel: summary.minimumDiplomaLevel == null ? null : labels.get(Number(summary.minimumDiplomaLevel)) || null, maximumDiplomaLabel: summary.maximumDiplomaLevel == null ? null : labels.get(Number(summary.maximumDiplomaLevel)) || null, examRequired: (summary.requiredExams || []).length > 0, accessPaths: paths || [], source: "compact_structured_runtime", matchedExcerpts: [], generatedAt: null };
  },

  expandConstraints(compact = {}, contexts) {
    const source = kind => kind === "official" ? "official_work_contexts" : kind === "computed" ? "computed_low_confidence" : "unknown";
    const expand = part => { const value = { ...(part || {}), source: source(part?.sourceKind) }; delete value.sourceKind; return value; };
    const physicalConstraints = expand(compact.physical);
    const scheduleConstraints = expand(compact.schedule);
    const mobilityConstraints = expand(compact.mobility);
    const confirmedSignals = (compact.officialSignals || []).map(signal => ({ label: contexts.get(signal.contextId)?.label || signal.target, target: signal.target, value: signal.value, evidenceStatus: "official_confirmed", sourceContextId: signal.contextId, confidence: signal.confidence }));
    return { constraints: { source: [compact.physical?.sourceKind, compact.schedule?.sourceKind, compact.mobility?.sourceKind].includes("official") ? "official_work_contexts" : "computed_low_confidence", physical: physicalConstraints, schedule: scheduleConstraints, mobility: mobilityConstraints }, physicalConstraints, scheduleConstraints, mobilityConstraints, officialConstraintSummary: { confirmedSignals, unknownDimensions: compact.unknownDimensions || [], source: confirmedSignals.length ? "official_work_contexts" : "unknown", confidence: Number(compact.confidence || 0) } };
  },

  expandMarket(row, marche) {
    const keys = { FR: "national", "REG-76": "regional", "DEP-11": "departmental" };
    const levels = { FR: "national", "REG-76": "regional", "DEP-11": "departmental" };
    const labels = { FR: "France", "REG-76": "Occitanie", "DEP-11": "Aude" };
    const stats = {};
    const fapTerritories = {};
    for (const territoryId of Object.keys(keys)) {
      const item = row?.territories?.[territoryId] || {};
      const sourceLevel = Number.isFinite(item.offersCount) ? levels[territoryId] : "none";
      stats[keys[territoryId]] = { sourceLevel, sourceName: sourceLevel === "none" ? null : "api_marche_travail", territoryId, territoryLabel: labels[territoryId], marketDataKind: "offers_volume", marketInterpretationLabel: "Volume d’offres observé", latestPeriodCode: marche.vintages?.offers || null, latestPeriodLabel: marche.vintages?.offers || null, offersFranceTravail12m: item.offersCount ?? null, offersAll12m: item.offersCount ?? null, offers12m: item.offersCount ?? null, absoluteOfferSignal: item.offersLevel === "very_high" ? "high" : item.offersLevel || "unknown", territorialOfferSignal: item.territorialSignal || "unknown", marketFreshness: "unknown", confidence: Number(item.confidence || 0) };
      if (item.statisticalScope === "fap_family" && item.availability !== "ambiguous") {
        const difficulty = Number.isFinite(item.recruitmentDifficultyRate) ? { status: "available", value: item.recruitmentDifficultyRate, confidence: item.confidence } : { status: "unavailable", value: null, confidence: 0 };
        const dares = item.tensionLevel && item.tensionLevel !== "unknown" ? { year: marche.vintages?.daresTension, territoryLabel: labels[territoryId], tension: { status: "available", value: null, level: item.tensionLevel, confidence: item.confidence, details: { publishedDiscreteClass: item.tensionClass, imputed: item.tensionImputed } }, publishedDiscreteClass: item.tensionClass, imputed: item.tensionImputed, displayAsOfficialClass: !item.tensionImputed && item.tensionClass !== null } : null;
        fapTerritories[territoryId] = [{ bmo: { year: marche.vintages?.bmo, territoryLabel: labels[territoryId], recruitmentProjects: { status: "unavailable", value: null, confidence: 0 }, recruitmentDifficulty: difficulty, seasonality: { status: "unavailable", value: null, confidence: 0 } }, dares }];
      }
    }
    const availableLevels = Object.values(stats).map(item => item.sourceLevel);
    return { romeCode: String(row?.jobId || "").replace(/^rome-/, ""), sourceLevel: availableLevels.includes("departmental") ? "departmental" : availableLevels.includes("regional") ? "regional" : availableLevels.includes("national") ? "national" : "none", sourceName: "api_marche_travail", sourceUpdatedAt: null, marketDataKind: "offers_volume", marketInterpretationLabel: "Volume d’offres observé", ...stats, bmo: { year: marche.vintages?.bmo, status: "not_connected", sourceLevel: "not_connected", usedInMarketScore: false, confidence: 0, mappingConfidence: 0 }, fapEnrichment: Object.keys(fapTerritories).length ? { sharedFamily: Object.values(row?.territories || {}).some(item => item.sharedFamily), territories: fapTerritories, displayEligible: true, rankingEligible: false, warning: "Statistique de famille FAP partagée ; elle ne décrit pas exclusivement ce métier." } : null };
  },

  async sha256(text) {
    if (!crypto?.subtle) throw new Error("Validation SHA-256 indisponible dans ce navigateur.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  },

  async openCache() {
    if (!window.indexedDB) return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.cacheDatabase, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.cacheStore);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async writeCache(bundle) {
    try {
      const database = await this.openCache();
      if (!database) return;
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(this.cacheStore, "readwrite");
        transaction.objectStore(this.cacheStore).put({ manifest: bundle.manifest, core: bundle.core, competences: bundle.competences, marche: bundle.marche, complete: true }, this.cacheKey);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    } catch (error) { /* Cache optionnel. */ }
  },

  async readCache() {
    try {
      const database = await this.openCache();
      if (!database) return null;
      const value = await new Promise((resolve, reject) => {
        const transaction = database.transaction(this.cacheStore, "readonly");
        const request = transaction.objectStore(this.cacheStore).get(this.cacheKey);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return value;
    } catch (error) { return null; }
  }
};
