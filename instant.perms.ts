// Docs: https://instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/core";

const rules = {
  $default: {
    allow: {
      view: "true",
      create: "true",
      update: "true",
      delete: "true",
    },
  },
  $users: {
    allow: {
      view: "auth.id == data.id",
    },
  },
  todos: {
    allow: {
      view: "true",
      create: "true",
      update: "true",
      delete: "true",
    },
  },
} satisfies InstantRules;

export default rules;
