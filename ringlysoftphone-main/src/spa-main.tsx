/**
 * Client-only entry used when the app is built as a static SPA and served by
 * the ASP.NET Core host from wwwroot. It reuses the exact same page component
 * as the TanStack Start build — no UI, layout or component changes.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { Route as HomeRoute } from "./routes/index";

const queryClient = new QueryClient();

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn't exist.</p>
        <a href="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Go home
        </a>
      </div>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute.options.component!,
});

// Any unknown client-side path renders the softphone shell (the ASP.NET host
// rewrites unknown routes to index.html, this keeps deep links working).
const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: HomeRoute.options.component!,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, catchAllRoute]),
  context: { queryClient },
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
