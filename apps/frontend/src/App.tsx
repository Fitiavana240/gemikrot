import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { DevicesPage } from './pages/DevicesPage';
import { RoutersPage } from './pages/RoutersPage';
import { PlansPage } from './pages/PlansPage';
import { CustomersPage } from './pages/CustomersPage';
import { VouchersPage } from './pages/VouchersPage';
import { PaymentsPage } from './pages/PaymentsPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/routers" element={<RoutersPage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
