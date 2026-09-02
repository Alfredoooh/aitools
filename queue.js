// ═══════════════════════════════════════════════════════════
// FILA — evita operações pesadas simultâneas (protege os 512MB)
// ═══════════════════════════════════════════════════════════

let queueTail = Promise.resolve();

function enqueueHeavy(fn) {
  const run = queueTail.then(fn, fn);
  queueTail = run.catch(() => {});
  return run;
}

function withTimeout(fn, ms = 30000) {
  return () => Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms)
    )
  ]);
}

module.exports = {
  enqueueHeavy,
  withTimeout,
};