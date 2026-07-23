import React from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('AliceCut renderer crashed', error, info)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-error" role="alert">
        <h1>AliceCut could not continue</h1>
        <p>Your source files were not changed. Reopen the app and load the last saved project.</p>
        <pre>{this.state.error.message}</pre>
        <button onClick={() => location.reload()}>Restart editor</button>
      </main>
    )
  }
}
