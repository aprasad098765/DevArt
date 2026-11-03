// With no login, the network boundary is the only protection. These checks keep other websites out:
// a page in the user's browser could otherwise reach this server through DNS rebinding or cross-site requests.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEV_CLIENT = new Set(['localhost:5173', '127.0.0.1:5173']);

const hostnameOf = (host: string) => { try { return new URL(`http://${host}`).hostname; } catch { return ''; } };

export const isLoopbackHost = (host: string) => LOOPBACK.has(hostnameOf(host)) || host === '::1';
export const remoteAllowed = () => process.env.DEVART_ALLOW_REMOTE === '1';

/** The Host header must name this machine, unless the operator has chosen to expose the server. */
export const hostAllowed = (host: string | undefined) => remoteAllowed() || (!!host && isLoopbackHost(host));

/** A request with no Origin isn't from a web page; one with an Origin must match this server. */
export function originAllowed(origin: string | undefined, host: string | undefined) {
  if (!origin) return true;
  try {
    const h = new URL(origin).host;
    return h === host || DEV_CLIENT.has(h);
  } catch {
    return false;
  }
}
