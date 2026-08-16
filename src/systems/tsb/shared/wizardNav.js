/**
 * Select-menu navigation for lineup / leaderboard setup.
 * Obscura uses buttons here; Ascendant keeps the same steps without button rows.
 */
function wizardNav({
  customId,
  extras = [],
  next = true,
  back = true,
  menu = true,
} = {}) {
  const options = [];

  for (const extra of extras) {
    const value = extra.value || String(extra.custom_id || "").split(":").pop();
    if (!value) continue;
    options.push({
      label: String(extra.label || value).slice(0, 100),
      value: String(value).slice(0, 100),
      ...(extra.description ? { description: String(extra.description).slice(0, 100) } : {}),
    });
  }

  if (back) options.push({ label: "Back", value: "back", description: "Previous step" });
  if (next) options.push({ label: "Next", value: "next", description: "Continue" });
  if (menu) options.push({ label: "TSB Menu", value: "main_menu", description: "Return to TSB Systems" });

  const seen = new Set();
  const unique = options.filter((opt) => {
    if (seen.has(opt.value)) return false;
    seen.add(opt.value);
    return true;
  }).slice(0, 25);

  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: customId,
      placeholder: "Choose an action",
      min_values: 1,
      max_values: 1,
      options: unique,
    }],
  };
}

function extraFromButton(button) {
  return {
    label: button.label,
    value: String(button.custom_id || "").split(":").pop(),
  };
}

module.exports = { wizardNav, extraFromButton };
