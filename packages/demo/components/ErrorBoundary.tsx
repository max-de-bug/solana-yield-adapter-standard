"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-lg border border-[#e74c3c]/50 bg-[#e74c3c]/10 p-6">
          <h2 className="mb-2 font-semibold text-[#e74c3c]">Something went wrong</h2>
          <p className="mb-3 text-sm text-muted">
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            className="rounded bg-[#e74c3c] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[#c0392b]"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
