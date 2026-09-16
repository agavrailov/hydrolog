import { Route, Switch, useLocation } from 'wouter';
import { labels } from './labels';
import { SiteList } from './SiteList';
import { SiteForm } from './SiteForm';
import { SurveyForm } from './SurveyForm';
import { SiteDetail } from './SiteDetail';
import { SurveyDetail } from './SurveyDetail';
import { LineCaptureScreen } from './LineCaptureScreen';
import { LineDetail } from './LineDetail';
import { ImportScreen } from './ImportScreen';
import { useSite, useSurvey } from '../cache/hooks';

function SiteEditRoute({ params }: { params: { id: string } }) {
  const row = useSite(params.id);
  const [, setLocation] = useLocation();
  if (!row) return <p>{labels.common.loading}</p>;
  return (
    <SiteForm
      mode="edit"
      siteRow={row}
      onSaved={() => setLocation(`/sites/${params.id}`)}
      onCancel={() => setLocation(`/sites/${params.id}`)}
    />
  );
}

function SurveyNewRoute({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  return (
    <SurveyForm
      mode="create"
      siteId={params.id}
      onSaved={(sv) => setLocation(`/sites/${params.id}/surveys/${sv.id}`)}
      onCancel={() => setLocation(`/sites/${params.id}`)}
    />
  );
}

function SurveyEditRoute({ params }: { params: { id: string; svId: string } }) {
  const row = useSurvey(params.svId);
  const [, setLocation] = useLocation();
  if (!row) return <p>{labels.common.loading}</p>;
  return (
    <SurveyForm
      mode="edit"
      surveyRow={row}
      onSaved={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
      onCancel={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}

function SiteDetailRoute({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  return (
    <SiteDetail
      siteId={params.id}
      onBack={() => setLocation('/')}
      onEdit={() => setLocation(`/sites/${params.id}/edit`)}
      onDeleted={() => setLocation('/')}
      onNewSurvey={() => setLocation(`/sites/${params.id}/surveys/new`)}
      onOpenSurvey={(svId) => setLocation(`/sites/${params.id}/surveys/${svId}`)}
    />
  );
}

function ImportRoute({ params }: { params: { id: string; svId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <ImportScreen
      surveyId={params.svId}
      onDone={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
      onCancel={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}

function SurveyDetailRoute({ params }: { params: { id: string; svId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <SurveyDetail
      surveyId={params.svId}
      onEdit={() => setLocation(`/sites/${params.id}/surveys/${params.svId}/edit`)}
      onBack={() => setLocation(`/sites/${params.id}`)}
      onImport={() => setLocation(`/sites/${params.id}/surveys/${params.svId}/import`)}
    />
  );
}

function LineNewRoute({ params }: { params: { id: string; svId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <LineCaptureScreen
      surveyId={params.svId}
      onSaved={(lineId) => setLocation(`/sites/${params.id}/surveys/${params.svId}/lines/${lineId}`)}
      onCancel={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}

function LineDetailRoute({ params }: { params: { id: string; svId: string; lnId: string } }) {
  const [, setLocation] = useLocation();
  return (
    <LineDetail
      lineId={params.lnId}
      onBack={() => setLocation(`/sites/${params.id}/surveys/${params.svId}`)}
    />
  );
}

function HomeRoute() {
  const [, setLocation] = useLocation();
  return (
    <SiteList
      onOpen={(id) => setLocation(`/sites/${id}`)}
      onNew={() => setLocation('/sites/new')}
    />
  );
}

function SiteNewRoute() {
  const [, setLocation] = useLocation();
  return (
    <SiteForm
      mode="create"
      onSaved={(site) => setLocation(`/sites/${site.id}`)}
      onCancel={() => setLocation('/')}
    />
  );
}

export function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sites/new" component={SiteNewRoute} />
      <Route path="/sites/:id/edit">
        {(params) => <SiteEditRoute params={params as { id: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/new">
        {(params) => <SurveyNewRoute params={params as { id: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId/edit">
        {(params) => <SurveyEditRoute params={params as { id: string; svId: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId/lines/new">
        {(params) => <LineNewRoute params={params as { id: string; svId: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId/lines/:lnId">
        {(params) => <LineDetailRoute params={params as { id: string; svId: string; lnId: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId/import">
        {(params) => <ImportRoute params={params as { id: string; svId: string }} />}
      </Route>
      <Route path="/sites/:id/surveys/:svId">
        {(params) => <SurveyDetailRoute params={params as { id: string; svId: string }} />}
      </Route>
      <Route path="/sites/:id">
        {(params) => <SiteDetailRoute params={params as { id: string }} />}
      </Route>
      <Route>
        <p>{labels.errors.notFound}</p>
      </Route>
    </Switch>
  );
}
