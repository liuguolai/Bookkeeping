import { t } from './i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LedgerProvider } from './context';
import { PwaPanel } from './PwaPanel';
import './styles.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="boot">
        <h1>{t('页面暂时无法显示')}</h1>
        <p>{t('已保存的数据不会因此清除。请重新打开应用。')}</p>
        <PwaPanel />
        <button className="primary" onClick={() => location.reload()}>
          {t('重新打开')}
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <LedgerProvider>
      <App />
    </LedgerProvider>
  </ErrorBoundary>,
);
