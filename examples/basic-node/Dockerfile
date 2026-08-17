FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml mcp-kit.tgz ./
RUN corepack enable && pnpm install --no-frozen-lockfile
COPY tsconfig.json ./
COPY commonjs-smoke.cjs ./
COPY commonjs-jest.test.cjs jest.config.cjs ./
COPY src ./src
RUN pnpm build
RUN node commonjs-smoke.cjs
RUN node -e "if (process.env.NODE_OPTIONS) throw new Error('Jest smoke must run without NODE_OPTIONS')"
RUN pnpm exec jest --runInBand --config jest.config.cjs

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]
