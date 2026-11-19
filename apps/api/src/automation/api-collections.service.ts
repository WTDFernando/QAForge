import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@qaforge/db';
import {
  createDispatcher,
  executeRequest,
  ImportError,
  importCollection,
  type ImportedFolder,
} from '@qaforge/runner';
import type {
  ApiAuth,
  ApiCollectionInput,
  ApiRequestInput,
  ImportCollectionInput,
  SendApiRequestInput,
} from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import type { ProjectCtx } from '../common/project-scope';
import { automationAllowsPrivate } from '../config/env';
import { PrismaService } from '../prisma/prisma.module';
import { environmentScope } from './environment-scope';

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;

@Injectable()
export class ApiCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Folders with their requests (summary fields), ordered for the tree. */
  async tree(projectId: string) {
    return this.prisma.client.apiCollection.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        requests: {
          select: {
            id: true,
            name: true,
            method: true,
            url: true,
            position: true,
            testCaseId: true,
            collectionId: true,
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  private async collectionOrThrow(db: Tx, projectId: string, id: string) {
    const c = await db.apiCollection.findFirst({ where: { id, projectId } });
    if (!c) throw new NotFoundException('Collection not found');
    return c;
  }

  async request(projectId: string, id: string) {
    const r = await this.prisma.client.apiRequest.findFirst({
      where: { id, collection: { projectId } },
      include: { testCase: { select: { id: true, seq: true, title: true } } },
    });
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  async createCollection(ctx: ProjectCtx, input: ApiCollectionInput) {
    return this.prisma.client.$transaction(async (tx) => {
      if (input.parentId) await this.collectionOrThrow(tx, ctx.projectId, input.parentId);
      const max = await tx.apiCollection.aggregate({
        where: { projectId: ctx.projectId, parentId: input.parentId ?? null },
        _max: { position: true },
      });
      const c = await tx.apiCollection.create({
        data: {
          projectId: ctx.projectId,
          parentId: input.parentId ?? null,
          name: input.name,
          description: input.description,
          variables: json(input.variables),
          auth: json(input.auth),
          position: (max._max.position ?? -1) + 1,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'api_collection',
        entityId: c.id,
        action: 'create',
        after: { name: c.name },
      });
      return c;
    });
  }

  async updateCollection(ctx: ProjectCtx, id: string, input: Partial<ApiCollectionInput>) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await this.collectionOrThrow(tx, ctx.projectId, id);
      if (input.parentId) {
        // No cycles: the new parent can't be this folder or one of its descendants.
        let p: string | null = input.parentId;
        while (p) {
          if (p === id) throw new BadRequestException('A folder cannot be moved into itself');
          p = (await this.collectionOrThrow(tx, ctx.projectId, p)).parentId;
        }
      }
      const c = await tx.apiCollection.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
          ...(input.variables !== undefined && { variables: json(input.variables) }),
          ...(input.auth !== undefined && { auth: json(input.auth) }),
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'api_collection',
        entityId: id,
        action: 'update',
        before: {
          name: before.name,
          parentId: before.parentId,
          variables: before.variables,
          auth: before.auth,
        },
        after: { name: c.name, parentId: c.parentId, variables: c.variables, auth: c.auth },
      });
      return c;
    });
  }

  async deleteCollection(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const c = await this.collectionOrThrow(tx, ctx.projectId, id);
      await tx.apiCollection.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'api_collection',
        entityId: id,
        action: 'delete',
        before: { name: c.name },
      });
    });
  }

  private async assertTestCase(tx: Tx, projectId: string, id: string | null | undefined) {
    if (!id) return;
    const t = await tx.testCase.findFirst({ where: { id, projectId, deletedAt: null } });
    if (!t) throw new BadRequestException('Linked test case not found in this project');
  }

  async createRequest(ctx: ProjectCtx, input: ApiRequestInput) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.collectionOrThrow(tx, ctx.projectId, input.collectionId);
      await this.assertTestCase(tx, ctx.projectId, input.testCaseId);
      const max = await tx.apiRequest.aggregate({
        where: { collectionId: input.collectionId },
        _max: { position: true },
      });
      const r = await tx.apiRequest.create({
        data: {
          ...this.requestData(input),
          collectionId: input.collectionId,
          position: (max._max.position ?? -1) + 1,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'api_request',
        entityId: r.id,
        action: 'create',
        after: { name: r.name, method: r.method, url: r.url },
      });
      return r;
    });
  }

  private requestData(input: Partial<ApiRequestInput>) {
    return {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.method !== undefined && { method: input.method }),
      ...(input.url !== undefined && { url: input.url }),
      ...(input.headers !== undefined && { headers: json(input.headers) }),
      ...(input.query !== undefined && { query: json(input.query) }),
      ...(input.body !== undefined && { body: json(input.body) }),
      ...(input.auth !== undefined && {
        auth: input.auth === null ? Prisma.DbNull : json(input.auth),
      }),
      ...(input.assertions !== undefined && { assertions: json(input.assertions) }),
      ...(input.extract !== undefined && { extract: json(input.extract) }),
      ...(input.testCaseId !== undefined && { testCaseId: input.testCaseId }),
    } as Prisma.ApiRequestUncheckedCreateInput & { name: string; url: string };
  }

  async updateRequest(ctx: ProjectCtx, id: string, input: Partial<ApiRequestInput>) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.apiRequest.findFirst({
        where: { id, collection: { projectId: ctx.projectId } },
      });
      if (!before) throw new NotFoundException('Request not found');
      if (input.collectionId) await this.collectionOrThrow(tx, ctx.projectId, input.collectionId);
      await this.assertTestCase(tx, ctx.projectId, input.testCaseId);
      const r = await tx.apiRequest.update({
        where: { id },
        data: {
          ...this.requestData(input),
          ...(input.collectionId && { collectionId: input.collectionId }),
          updatedById: ctx.actor.id,
        },
      });
      const pick = (x: typeof r) => ({
        name: x.name,
        method: x.method,
        url: x.url,
        headers: x.headers,
        query: x.query,
        body: x.body,
        auth: x.auth,
        assertions: x.assertions,
        extract: x.extract,
        testCaseId: x.testCaseId,
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'api_request',
        entityId: id,
        action: 'update',
        before: pick(before),
        after: pick(r),
      });
      return r;
    });
  }

  async deleteRequest(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const r = await tx.apiRequest.findFirst({
        where: { id, collection: { projectId: ctx.projectId } },
      });
      if (!r) throw new NotFoundException('Request not found');
      await tx.apiRequest.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'api_request',
        entityId: id,
        action: 'delete',
        before: { name: r.name },
      });
    });
  }

  /** Effective auth for a collection: walk up the tree past "inherit". */
  async effectiveAuth(
    db: Tx,
    collectionId: string,
  ): Promise<{ auth: ApiAuth; variables: Record<string, string> }> {
    const chain: { auth: ApiAuth; variables: Record<string, string> }[] = [];
    let id: string | null = collectionId;
    while (id && chain.length < 20) {
      const c: { parentId: string | null; auth: unknown; variables: unknown } | null =
        await db.apiCollection.findUnique({
          where: { id },
          select: { parentId: true, auth: true, variables: true },
        });
      if (!c) break;
      chain.push({ auth: c.auth as ApiAuth, variables: c.variables as Record<string, string> });
      id = c.parentId;
    }
    // Root variables first so nearer folders override them.
    const variables = Object.assign({}, ...chain.map((c) => c.variables).reverse());
    const auth = chain.find((c) => c.auth.type !== 'inherit')?.auth ?? { type: 'none' as const };
    return { auth, variables };
  }

  /** Send one request from the editor (unsaved edits allowed). Nothing is stored. */
  async send(ctx: ProjectCtx, input: SendApiRequestInput) {
    const db = this.prisma.client;
    await this.collectionOrThrow(db, ctx.projectId, input.collectionId);
    const { auth, variables } = await this.effectiveAuth(db, input.collectionId);
    const envScope = await environmentScope(db, ctx.projectId, input.environmentId);
    const allowPrivate = automationAllowsPrivate();
    const dispatcher = createDispatcher({ allowPrivate, timeoutMs: 30_000 });
    try {
      return await executeRequest(
        {
          name: 'request',
          method: input.method,
          url: input.url,
          headers: input.headers,
          query: input.query,
          body: input.body,
          auth: input.auth,
          assertions: input.assertions,
          extract: input.extract,
        },
        {
          scope: {
            vars: {
              ...(envScope.baseUrl ? { baseUrl: envScope.baseUrl } : {}),
              ...variables,
              ...input.variables,
            },
            env: envScope.env,
            secrets: envScope.secrets,
          },
          collectionAuth: auth,
          allowPrivate,
          dispatcher,
          timeoutMs: 30_000,
          tokenCache: new Map(),
        },
      );
    } finally {
      await dispatcher.close();
    }
  }

  async import(ctx: ProjectCtx, input: ImportCollectionInput) {
    let tree: ImportedFolder;
    try {
      tree = importCollection(input.format, input.content, input.fileName);
    } catch (e) {
      if (e instanceof ImportError) throw new BadRequestException(e.message);
      throw new BadRequestException(`Could not read the file: ${(e as Error).message}`);
    }
    return this.prisma.client.$transaction(
      async (tx) => {
        let count = 0;
        const insertRequests = async (collectionId: string, folder: ImportedFolder) => {
          if (!folder.requests.length) return;
          const max = await tx.apiRequest.aggregate({
            where: { collectionId },
            _max: { position: true },
          });
          const start = (max._max.position ?? -1) + 1;
          await tx.apiRequest.createMany({
            data: folder.requests.map((r, i) => ({
              collectionId,
              name: r.name.slice(0, 200),
              method: r.method,
              url: r.url.slice(0, 4000),
              headers: json(r.headers),
              query: json(r.query),
              body: json(r.body),
              auth: r.auth ? json(r.auth) : undefined,
              assertions: json(r.assertions),
              extract: json(r.extract),
              position: start + i,
              createdById: ctx.actor.id,
              updatedById: ctx.actor.id,
            })),
          });
          count += folder.requests.length;
        };
        const create = async (
          folder: ImportedFolder,
          parentId: string | null,
          position: number,
        ): Promise<string> => {
          const c = await tx.apiCollection.create({
            data: {
              projectId: ctx.projectId,
              parentId,
              name: folder.name.slice(0, 200),
              variables: json(folder.variables),
              auth: json(folder.auth),
              position,
              importedFrom: parentId
                ? undefined
                : json({ format: input.format, fileName: input.fileName }),
              createdById: ctx.actor.id,
            },
          });
          await insertRequests(c.id, folder);
          for (const [i, f] of folder.folders.entries()) await create(f, c.id, i);
          return c.id;
        };
        let collectionId: string;
        if (input.collectionId) {
          // Single requests (cURL, Bruno) can go into an existing folder.
          await this.collectionOrThrow(tx, ctx.projectId, input.collectionId);
          collectionId = input.collectionId;
          await insertRequests(collectionId, tree);
          for (const [i, f] of tree.folders.entries()) await create(f, collectionId, i);
        } else {
          const max = await tx.apiCollection.aggregate({
            where: { projectId: ctx.projectId, parentId: null },
            _max: { position: true },
          });
          collectionId = await create(tree, null, (max._max.position ?? -1) + 1);
        }
        await this.audit.record(tx, ctx.actor, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          entityType: 'api_collection',
          entityId: collectionId,
          action: 'import',
          metadata: { format: input.format, fileName: input.fileName, requests: count },
        });
        return { collectionId, requests: count, name: tree.name };
      },
      { timeout: 60_000 },
    );
  }
}
