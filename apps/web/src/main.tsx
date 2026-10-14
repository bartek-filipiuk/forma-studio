import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuthShell from "./AuthShell";
import "./public.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthShell />
    </QueryClientProvider>
  </React.StrictMode>,
);
