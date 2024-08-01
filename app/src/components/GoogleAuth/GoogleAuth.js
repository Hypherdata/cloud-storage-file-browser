import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Header, Icon, Modal, Message } from 'semantic-ui-react';
import  * as jwtDecode  from 'jwt-decode';
import api from "../../api/storage";

const GoogleAuth = ({ setIdToken, setProfile }) => {
  const [open, setOpen] = useState(true);
  const [error, setError] = useState(null);

  const onSuccess = (credentialResponse) => {
    const credentialResponseDecoded = jwtDecode.jwtDecode(credentialResponse.credential);
    console.log(credentialResponseDecoded);
    setIdToken(credentialResponse.credential);

    api.getSettings().then(settings => {
      console.log(credentialResponseDecoded);
      setProfile({
        name: credentialResponseDecoded.name,
        imageUrl: credentialResponseDecoded.picture,
        email: credentialResponseDecoded.email,
        role:  settings.cdnAdmins.includes(credentialResponseDecoded.email) ? 'admin' :
               settings.cdnUploaders.includes(credentialResponseDecoded.email) ? 'uploader' :
               settings.cdnDownloaders.includes(credentialResponseDecoded.email) ? 'downloader' : 'uploader'
      });
    })
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
