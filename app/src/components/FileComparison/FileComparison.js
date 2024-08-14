import React, { useState } from 'react';
import { Button, Progress, Message } from 'semantic-ui-react';
import api from '../../api/storage';
import {toast} from "react-toastify";

const FileComparison = () => {
  const [isComparing, setIsComparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const startComparison = async () => {
    setIsComparing(true);
    setProgress(0);
    setResult(null);
    setError(null);

    try {
      await api.startFileComparison()

      const eventSource = new EventSource('/file-comparison-progress', {
        headers: {
          'Authorization': `Bearer ${api.idToken}`
        }
      });

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProgress(data.percentComplete);
      };

      eventSource.onerror = (error) => {
        eventSource.close();
        setError('An error occurred during file comparison');
        setIsComparing(false);
      };

      eventSource.addEventListener('complete', (event) => {
        const result = JSON.parse(event.data);
        setResult(result);
        setIsComparing(false);
        eventSource.close();
      });
    } catch (error) {
      setError('Failed to start file comparison');
      setIsComparing(false);
    }
  };

  return (
    <div>
      <Button
        onClick={startComparison}
        disabled={isComparing}
        loading={isComparing}
      >
        Start File Comparison
      </Button>

      {isComparing && (
        <Progress percent={progress} indicating>
          Comparing files...
        </Progress>
      )}

      {error && (
        <Message negative>
          <Message.Header>Error</Message.Header>
          <p>{error}</p>
        </Message>
      )}

      {result && (
        <Message positive>
          <Message.Header>Comparison Complete</Message.Header>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </Message>
      )}
    </div>
  );
};

export default FileComparison;
