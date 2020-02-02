const { join } = require("path");

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
  } else {
    throw new Error("cannot merge: " + target + " <- " + source);
  }

  return target;
}

function isObject(obj) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}

async function readYaml(path) {
  const content = await readFile(path, "utf8");
  return safeLoadAll(content);
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

function toTitleCase(str) {
  return str.replace(
    /\w+/g,
    s => s.charAt(0).toUpperCase() + s.substr(1).toLowerCase()
  );
}

function startsWithUppercase(str) {
  return typeof str === "string" && str[0] === str[0].toUpperCase();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  merge,
  readYaml,
  walk,
  toTitleCase,
  startsWithUppercase,
  clone
};