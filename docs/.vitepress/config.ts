import { defineConfig } from "vitepress";

export default defineConfig({
  title: "LibRE Bayes",
  description:
    "A free, open-source, cross-platform desktop editor for Bayesian Networks and Dynamic Bayesian Networks.",
  // GitHub Pages project-site path -- must match the repo name exactly, or
  // every asset/link resolves against the wrong base and 404s.
  base: "/libre-bayes/",
  cleanUrls: true,
  lastUpdated: true,

  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/libre-bayes/favicon.svg" }]],

  themeConfig: {
    logo: "/favicon.svg",

    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Dynamic BN", link: "/dynamic-bayesian-networks" },
      { text: "Reference", link: "/data-contract" },
      { text: "GitHub", link: "https://github.com/A-K-T-K/libre-bayes" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is LibRE Bayes?", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Modeling Canvas", link: "/canvas" },
          { text: "Inference", link: "/inference" },
          { text: "Learning from Data", link: "/learning" },
          { text: "Explainability", link: "/explainability" },
          { text: "Dynamic Bayesian Networks", link: "/dynamic-bayesian-networks" },
          { text: "Import / Export", link: "/import-export" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Data Contract", link: "/data-contract" },
          { text: "Extending the Engine", link: "/extending" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/A-K-T-K/libre-bayes" }],

    search: { provider: "local" },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 LibRE Bayes contributors",
    },

    editLink: {
      pattern: "https://github.com/A-K-T-K/libre-bayes/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
