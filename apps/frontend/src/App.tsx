import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
import { RouterToolsPage } from './pages/RouterToolsPage';
import { RecettesPage } from './pages/RecettesPage';
import { BatchesPage } from './pages/BatchesPage';
import { CustomerSheetPage } from './pages/CustomerSheetPage';
import { SettingsPage } from './pages/SettingsPage';
import { TenantsPage } from './pages/TenantsPage';
import { SupervisionPage } from './pages/SupervisionPage';
import { PppoePage } from './pages/PppoePage';
import { UserManagerPage } from './pages/UserManagerPage';
import { HotspotPage } from './pages/HotspotPage';
import { TicketPrintPage, TicketTemplatesPage } from './pages/TicketTemplatesPage';
import { SignupPage } from './pages/SignupPage';
import { PublicPaymentPage } from './pages/public/PublicPaymentPage';
import { PlansPage } from './pages/PlansPage';
import { CustomersPage } from './pages/CustomersPage';
import { VouchersPage } from './pages/VouchersPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { AbonnementPage } from './pages/AbonnementPage';
import { EquipePage } from './pages/EquipePage';
import { Protege } from './components/Protege';

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
            <Route path="/routers" element={<Protege><RoutersPage /></Protege>} />
            <Route path="/recettes" element={<RecettesPage />} />
            <Route path="/diagnostic" element={<Protege><RouterToolsPage /></Protege>} />
            <Route path="/diagnostic/:tab" element={<Protege><RouterToolsPage /></Protege>} />
            <Route path="/hotspot" element={<Protege><HotspotPage /></Protege>} />
            {/* L'ancienne adresse de la page de connexion : elle a rejoint
                Paramètres. Rediriger plutôt que laisser retomber sur l'onglet
                Serveurs, qui n'aurait rien dit et laissé chercher. */}
            <Route
              path="/hotspot/page-connexion"
              element={<Navigate to="/settings/portail" replace />}
            />
            <Route path="/hotspot/:tab" element={<Protege><HotspotPage /></Protege>} />
            <Route path="/pppoe" element={<Protege><PppoePage /></Protege>} />
            <Route path="/pppoe/:tab" element={<Protege><PppoePage /></Protege>} />
            <Route path="/user-manager" element={<Protege><UserManagerPage /></Protege>} />
            <Route path="/user-manager/:tab" element={<Protege><UserManagerPage /></Protege>} />
            <Route path="/ticket-templates" element={<TicketTemplatesPage />} />
            <Route path="/ticket-print" element={<TicketPrintPage />} />
            <Route path="/audit" element={<Protege><AuditPage /></Protege>} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Les reglages sont regroupes en onglets : la marque, le modele
                de ticket, le portail captif, le compte et l'apparence. */}
            <Route path="/settings/:tab" element={<SettingsPage />} />
            <Route path="/tenants" element={<Protege><TenantsPage /></Protege>} />
            <Route path="/supervision" element={<Protege><SupervisionPage /></Protege>} />
            <Route path="/plans" element={<Protege><PlansPage /></Protege>} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerSheetPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/vouchers/:tab" element={<VouchersPage />} />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            {/* Toujours atteignable, meme abonnement expire : c'est la page
                qui dit quoi payer, et a qui. */}
            <Route path="/abonnement" element={<Protege><AbonnementPage /></Protege>} />
            <Route path="/equipe" element={<Protege><EquipePage /></Protege>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
