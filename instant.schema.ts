// Docs: https://instantdb.com/docs/modeling-data

import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
    }),
    todos: i.entity({
      text: i.string(),
      done: i.boolean(),
      createdAt: i.number(),
    }),
  },
  links: {
    $usersLinkedPrimaryUser: {
      forward: {
        on: "$users",
        has: "one",
        label: "linkedPrimaryUser",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "linkedGuestUsers",
      },
    },
  },
  rooms: {
    todos: {
      presence: i.entity({
        x: i.number(),
        y: i.number(),
        z: i.number(),
        yaw: i.number(),
        pitch: i.number(),
        hp: i.number(),
        alive: i.boolean(),
        color: i.string(),
        name: i.string(),
      }),
      topics: {
        damage: i.entity({
          targetPeerId: i.string(),
          shooterPeerId: i.string().optional(),
          amount: i.number(),
          at: i.number().optional(),
        }),
      },
    },
    arena: {
      presence: i.entity({
        x: i.number(),
        y: i.number(),
        z: i.number(),
        yaw: i.number(),
        pitch: i.number(),
        hp: i.number(),
        alive: i.boolean(),
        color: i.string(),
        name: i.string(),
      }),
      topics: {
        damage: i.entity({
          targetPeerId: i.string(),
          shooterPeerId: i.string().optional(),
          amount: i.number(),
          at: i.number().optional(),
        }),
      },
    },
  },
});

// This helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
