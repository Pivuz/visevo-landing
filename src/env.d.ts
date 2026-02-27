/// <reference path="../.astro/types.d.ts" />

type D1Database = import('@cloudflare/workers-types').D1Database;

type Runtime = import('@astrojs/cloudflare').Runtime<{
  DB: D1Database;
}>;

declare namespace App {
  interface Locals extends Runtime {}
}
