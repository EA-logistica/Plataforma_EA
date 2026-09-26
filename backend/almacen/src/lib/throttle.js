// Cola que garantiza un intervalo mínimo entre llamadas (p. ej. Nominatim: máx. 1 solicitud/segundo).
export function createThrottle(minIntervalMs) {
  let chain = Promise.resolve();
  let last = 0;
  return function throttle(fn) {
    const run = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}
