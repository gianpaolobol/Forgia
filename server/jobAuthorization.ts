// Authorization is a fresh check, not a guarantee of reversing an upstream effect.
export type JobAuthorization = (session: string, grant: string) => Promise<boolean>;
export const grantPattern = /^[a-f0-9]{64}$/;
const denied = () => Object.assign(Error('Autorizzazione del lavoro non più valida.'), {status: 403});

export async function runAuthorized<R>(authorize: JobAuthorization, session: string, grant: string | undefined,
  run: (signal: AbortSignal) => Promise<R>, pollMs = 250): Promise<R> {
  if (!grant || !grantPattern.test(grant)) throw denied();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking: Promise<boolean> | undefined;
  function check(): Promise<boolean> {
    if (checking) return checking;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    checking = Promise.race([
      Promise.resolve().then(() => authorize(session, grant!)),
      new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 1000); }),
    ]).then(value => value === true, () => false).finally(() => {clearTimeout(timeout); checking = undefined;});
    return checking;
  }
  if (!await check()) throw denied();
  const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(denied()), {once: true}));
  function schedule() {
    timer = setTimeout(async () => {
      if (!await check()) controller.abort();
      else if (!controller.signal.aborted && !finished) schedule();
    }, pollMs);
  }
  let finished = false;
  schedule();
  try {
    const result = await Promise.race([Promise.resolve().then(() => run(controller.signal)), stopped]);
    // Do not share an in-progress poll: it may predate completion of the work.
    if (checking) await checking;
    if (controller.signal.aborted || !await check() || controller.signal.aborted) throw denied();
    return result;
  } finally {
    finished = true;
    clearTimeout(timer);
    // Do not abort a successful result after return; an outstanding poll is harmless.
  }
}
