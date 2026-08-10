// Alias historique conservé pour les appels existants. L'activation ne modifie
// plus le code applicatif : elle publie uniquement le pointeur de données actif.
process.env.RUNTIME_EXPECTED_JOBS_COUNT ||= "800";
process.env.RUNTIME_ROME_SUBDIR ||= "rome800-candidate";

const { main } = await import("./write-active-runtime-descriptor.mjs");
await main();
