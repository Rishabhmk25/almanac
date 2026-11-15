const major = parseInt(process.versions.node.split(".")[0], 10);

if (major < 22) {
  console.warn(
    `\x1b[33m⚠  Node ${process.versions.node} detected. Almanac targets Node >= 22.\x1b[0m`
  );
  console.warn(
    "   Some features (e.g. built-in fetch, crypto.randomUUID) may be unavailable."
  );
}
