/** Auth.js needs its CSRF token with every credentials post. */
export const fetchCsrfToken = async (): Promise<string> => {
  const response = await fetch('/api/auth/csrf');
  const body = (await response.json()) as { csrfToken: string };

  return body.csrfToken;
};

/**
 * Signs in through the Auth.js `password` provider with a real form post, so
 * the session cookie is set by the redirect response like any browser login.
 */
export const submitPasswordSignIn = (
  csrfToken: string,
  identifier: string,
  password: string,
  callbackUrl = '/boards',
) => {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/api/auth/callback/password';

  Object.entries({ csrfToken, identifier, password, callbackUrl }).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
};
