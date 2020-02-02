function toTitleCase(str) {
  return str.replace(
    /\w+/g,
    s => s.charAt(0).toUpperCase() + s.substr(1).toLowerCase()
  );
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { toTitleCase, clone };
