import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-2xl font-semibold">Algo salió mal</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Ocurrió un error inesperado. Podés intentar recargar la página.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Recargar página
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
