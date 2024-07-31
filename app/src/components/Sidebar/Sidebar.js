import React from 'react'
import { Header, Icon, Menu, Sidebar, Segment, Image } from 'semantic-ui-react'
import config from '../../config'

export default ({ profile, openFileUpload, openFolderCreator, openSettings }) => {

  const signOut = () => {
    window.gapi.auth2.getAuthInstance().signOut()
    localStorage.clear()
    window.location.reload()
  }

  return (
    <Sidebar
      as={Menu}
      icon='labeled'
      inverted
      vertical
      visible
      width='thin'
    >
      <Header as='h4' color='grey' style={{ margin: '10px auto' }}>{ config.appName }</Header>
      <Header as='h5' color='grey' style={{ margin: '10px auto' }}>{ profile.role }</Header>
      <Image src={profile.imageUrl} avatar/>
      <Header as='h5' color='grey' style={{ margin: '10px auto' }}>{ profile.name }</Header>
      <Menu.Item as='a'>
        <Icon name='folder' />
        Files
      </Menu.Item>
      {(profile.role ==='admin' || profile.role === 'uploader') &&
        <Menu.Item as='a' onClick={openFileUpload}>
          <Icon name='cloud upload' />
          Upload File(s)
        </Menu.Item>
      }
      {(profile.role ==='admin' || profile.role === 'uploader') &&
          <Menu.Item as='a' onClick={openFolderCreator}>
            <Icon name='plus circle' />
            New Folder
          </Menu.Item>
      }
      {(profile.role ==='admin') &&
          <Menu.Item as='a' onClick={openSettings}>
            <Icon name='settings' />
            Options
          </Menu.Item>
      }
      <Menu.Item as='a' onClick={signOut}>
        <Icon name='sign-out' />
        Sign Out
      </Menu.Item>
    </Sidebar>
  )
}
