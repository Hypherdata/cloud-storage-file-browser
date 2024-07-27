import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Header, Icon, Modal, Message } from 'semantic-ui-react';
import  * as jwtDecode  from 'jwt-decode';

const GoogleAuth = ({ setIdToken, setProfile }) => {
  const [open, setOpen] = useState(true);
  const [error, setError] = useState(null);

  const onSuccess = (credentialResponse) => {
    const credentialResponseDecoded = jwtDecode.jwtDecode(credentialResponse.credential);
    setIdToken(credentialResponse.credential);
    setProfile({
      name: credentialResponseDecoded.name,
      imageUrl: credentialResponseDecoded.picture,
      email: credentialResponseDecoded.email
    });
    setOpen(false);
  };

  const onError = () => {
    setError('Google Sign-In was unsuccessful. Please try again.');
  };

  return (
      <Modal
          basic
          centered
          open={open}
          size='small'
      >
        <Header icon>
          <Icon name={error ? 'warning circle' : 'sign in'} />
          {error ? 'Something went wrong' : 'Sign In'}
        </Header>
        <Modal.Content>
          {error && (
              <Message negative>
                <Message.Header>Error</Message.Header>
                <p>{error}</p>
              </Message>
          )}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
                onSuccess={onSuccess}
                onError={onError}
                useOneTap
            />
          </div>
        </Modal.Content>
      </Modal>
  );
};

export default GoogleAuth;
