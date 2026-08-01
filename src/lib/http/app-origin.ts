const isLocalhost = (hostname: string) => hostname === "localhost";

const parseConfiguredOrigin = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN must be a valid absolute origin");
  }

  if (
    url.username ||
    url.password ||
    value.endsWith("/") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_ORIGIN must not include credentials, a path, query, or fragment");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
    throw new Error("APP_ORIGIN must use HTTPS, except for http://localhost local smoke tests");
  }

  return url.origin;
};

export const getCanonicalAppOrigin = (
  requestUrl: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const configuredOrigin = env.APP_ORIGIN?.trim();
  if (configuredOrigin) {
    return parseConfiguredOrigin(configuredOrigin);
  }

  if (env.NODE_ENV === "production") {
    throw new Error("APP_ORIGIN is required in production");
  }

  try {
    return new URL(requestUrl).origin;
  } catch {
    throw new Error("Request URL must contain a valid absolute origin");
  }
};
