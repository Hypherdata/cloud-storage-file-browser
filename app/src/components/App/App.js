import React, { useState } from 'react';
import logo from '../../assets/logo.svg';
import './App.css';
import { ToastContainer } from 'react-toastify'
import Sidebar from '../Sidebar/Sidebar'
import FileExplorer from '../FileExplorer/FileExplorer'
import Auth from '../GoogleAuth/GoogleAuth'
import FileUploadModal from '../FileUploadModal/FileUploadModal'
import FolderCreationModal from '../FolderCreationModal/FolderCreationModal'
import SettingsModal from '../SettingsModal/SettingsModal'
import api from '../../api/storage'
import { GoogleOAuthProvider } from '@react-oauth/google';
import config from "../../config";
import FileComparison from "../FileComparison/FileComparison";

function App() {
  const [idToken, setIdToken] = useState('')
  const [profile, setProfile] = useState({})

  const [explorerPath, setExplorerPath] = useState('') // Current file explorer path
  const [doRefresh, refreshExplorer] = useState(true)

  const [fileUploadOpen, setFileUploadOpen] = useState(false)
  const [folderCreatorOpen, setFolderCreatorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fileComparisonOpen, setFileComparisonOpen] = useState(false)

    return (
    <div className="App">
      <nav>
          { profile.role !== 'user' &&
              <Sidebar
                  profile={profile}
                  openFileUpload={() => setFileUploadOpen(true)}
                  openFolderCreator={() => setFolderCreatorOpen(true)}
                  openSettings={() => setSettingsOpen(true)}
                  openFileComparison={() => setFileComparisonOpen(true)}
            />
          }
      </nav>
        <GoogleOAuthProvider clientId={config.googleClientId}>
      <Auth setIdToken={(t) => {
        api.idToken = t
        setIdToken(t)
      }} setProfile={setProfile}/>
      <section className='app-content'>
        { profile.role !== 'user' &&  !fileComparisonOpen && <FileExplorer
          idToken={idToken}
          profile={profile}
          setExplorerPath={setExplorerPath}
          doRefresh={doRefresh}
          didRefresh={() => refreshExplorer(false)}
        />
        }
        { profile.role === 'user' &&
          <div>
            You need to be authorized by HD team please lets as know via email on admin@hypherdata.com
            Name: {profile.name} - Role: {profile.role}
          </div>
        }
        { fileComparisonOpen && <FileComparison />

        }
      </section>
      <FileUploadModal
        open={fileUploadOpen}
        closeModal={() => {setFileUploadOpen(false); refreshExplorer(true)}}
        path={explorerPath}
        onSuccess={() => {setFileUploadOpen(false); refreshExplorer(true)}}
      />
      <FolderCreationModal
        open={folderCreatorOpen}
        closeModal={() => setFolderCreatorOpen(false)}
        path={explorerPath}
        onSuccess={() => {setFolderCreatorOpen(false); refreshExplorer(true)}}
      />
      <SettingsModal
        open={settingsOpen}
        closeModal={() => setSettingsOpen(false)}
      />
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
        </GoogleOAuthProvider>

    </div>
  );
}

export default App;
