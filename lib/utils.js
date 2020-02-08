const { join } = require("path");
const { stdin } = require("process");

const { readdir, stat, readFile } = require("fs-extra");
const { safeLoadAll } = require("js-yaml");

function merge(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) {
    for (const obj of source) {
      const existing = target.find(item => item.name === obj.name);
      if (existing) {
        merge(existing, obj);
      } else {
        target.push(obj);
      }
    }
  } else if (isObject(target) && isObject(source)) {
    for (const [key, val] of Object.entries(source)) {
      const t = target[key];
      if (Array.isArray(t) || isObject(t)) {
        merge(t, val);
      } else {
        target[key] = val;
      }
    }
  } else if (target == null && source != null) {
    return source;
  } else if (target != null && source == null) {
    return target;
  } else if (target === source) {
    return target;
  } else {
    throw new Error("cannot merge: " + target + " <- " + source);
  }

  return target;
}

function isObject(obj) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}

function readYaml(path) {
  return (path === "-" ? readStdin() : readFile(path, "utf8")).then(
    safeLoadAll
  );
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const data = [];
    stdin.setEncoding("utf8");
    stdin.on("data", chunk => data.push(chunk));
    stdin.on("error", err => reject(err));
    stdin.on("end", () => resolve(data.join("")));
  });
}

async function walk(path, filter, dir = null) {
  if (dir == null) {
    const stats = await stat(path);
    dir = stats.isDirectory();
  }
  if (dir) {
    if (!filter(path, true)) {
      return [];
    }
    const entries = await readdir(path, { withFileTypes: true });
    return Promise.all(
      entries.map(entry => {
        const p = join(path, entry.name);
        const dir = entry.isDirectory();
        return filter(p, dir) ? (dir ? walk(p, filter, true) : [p]) : [];
      })
    ).then(arr => arr.flat());
  } else {
    return [path].filter(p => filter(p, false));
  }
}

function toTitleCase(str, always = true) {
  return startsWithUppercase(str) && !always
    ? str
    : str.replace(
        /\w+/g,
        s => s.charAt(0).toUpperCase() + s.substr(1).toLowerCase()
      );
}

function startsWithUppercase(str) {
  return str && typeof str[0] === "string" && str[0] === str[0].toUpperCase();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  merge,
  readYaml,
  walk,
  toTitleCase,
  clone
};
