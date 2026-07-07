import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import { dashboardI18n } from "../../lib/i18n";

export function AppProviders({ children }: PropsWithChildren) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
    []
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={dashboardI18n}>
        <BrowserRouter>{children}</BrowserRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
