import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { RouterProvider } from './routers/RouterContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { DevicesPage } from './pages/DevicesPage';
import { RoutersPage } from './pages/RoutersPage';
import { AuditPage } from './pages/AuditPage';
import { BatchesPage } from './pages/BatchesPage';
import { CustomerSheetPage } from './pages/CustomerSheetPage';
import { SettingsPage } from './pages/SettingsPage';
import { TenantsPage } from './pages/TenantsPage';
import { UserManagerPage } from './pages/UserManagerPage';
import { HotspotPage } from './pages/HotspotPage';
import { TicketPrintPage, TicketTemplatesPage } from './pages/TicketTemplatesPage';
import { SignupPage } from './pages/SignupPage';
import { PublicPaymentPage } from './pages/public/PublicPaymentPage';
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
          <Route path="/signup" element={<SignupPage />} />
          {/* Page client : hors du bloc authentifié, comme /login. */}
          <Route path="/p/:slug" element={<PublicPaymentPage />} />
          <Route
            element={
              <RequireAuth>
                <RouterProvider>
                  <Layout />
                </RouterProvider>
              </RequireAuth>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/routers" element={<RoutersPage />} />
            <Route path="/hotspot" element={<HotspotPage />} />
            <Route path="/hotspot/:tab" element={<HotspotPage />} />
            <Route path="/user-manager" element={<UserManagerPage />} />
            <Route path="/user-manager/:tab" element={<UserManagerPage />} />
            <Route path="/ticket-templates" element={<TicketTemplatesPage />} />
            <Route path="/ticket-print" element={<TicketPrintPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerSheetPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/vouchers/:tab" element={<VouchersPage />} />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
