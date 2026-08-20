/** Await value when the remote API client returns a Promise. */
async function resolveMaybe(value) {
  if (value != null && typeof value.then === "function") return value;
  return value;
}

module.exports = { resolveMaybe };
