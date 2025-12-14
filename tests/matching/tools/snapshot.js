#!/usr/bin/env node
// tests/matching/tools/snapshot.js
// Exports posts and items from DB to JSON fixtures for testing

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

const prisma = new PrismaClient();

async function exportPosts() {
  console.log('Exporting posts...');
  const posts = await prisma.post.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      link: true,
      content: true,
      createdAt: true,
      isAnalyzed: true,
    },
  });

  const outputPath = join(FIXTURES_DIR, 'posts.json');
  writeFileSync(outputPath, JSON.stringify(posts, null, 2));
  console.log(`Exported ${posts.length} posts to ${outputPath}`);
  return posts.length;
}

async function exportItems() {
  console.log('Exporting items...');
  const items = await prisma.item.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      examine: true,
      members: true,
      limit: true,
      value: true,
      highalch: true,
      lowalch: true,
    },
  });

  const outputPath = join(FIXTURES_DIR, 'items.json');
  writeFileSync(outputPath, JSON.stringify(items, null, 2));
  console.log(`Exported ${items.length} items to ${outputPath}`);
  return items.length;
}

async function main() {
  try {
    mkdirSync(FIXTURES_DIR, { recursive: true });

    const postCount = await exportPosts();
    const itemCount = await exportItems();

    console.log(`\nSnapshot complete:`);
    console.log(`  Posts: ${postCount}`);
    console.log(`  Items: ${itemCount}`);
  } catch (err) {
    console.error('Snapshot failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
