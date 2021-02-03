module.exports = {
  overrides: [
    {
      files: "*.ts",
      options: {
        printWidth: 100,
      },
    },
    {
      files: "*.sol",
      options: {
        printWidth: 100,
        tabWidth: 4,
        bracketSpacing: false,
        explicitTypes: "always",
      },
    },
  ],
};
