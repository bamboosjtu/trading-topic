const { resolve } = require("node:path");

module.exports = {
  plugins: [
    require("tailwindcss")(resolve(__dirname, "tailwind.config.ts")),
    require("autoprefixer"),
  ],
};
