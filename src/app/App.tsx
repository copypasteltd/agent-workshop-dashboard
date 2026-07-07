import { AppRouter } from "./router/AppRouter";
import { AppProviders } from "./providers/AppProviders";

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
