import React, { useState } from 'react'
import './FileCard.css'
import { Card, List, Button, Icon, Dropdown, Checkbox, Dimmer } from 'semantic-ui-react'
import { getIconByMIMEType } from '../../util/fileutil'
import TiffThumbnail from './TiffThumbnail';

const FileCard = ({ cardType, isFolder, path, name, size, fileType, lastMod, isDimmed, checkIsPublic, onDelete, onRename, onMove, onClickItem, onDownload, onSetPublic, isDownloader = false, isUploader = false, isAdmin = false}) => {
  const [isPublic, setIsPublic] = useState(false)

  const fileIcon = getIconByMIMEType(fileType, isFolder)

  if (cardType === 'list') { // File card for list view
    return (
      <List.Item className={isFolder ? 'folder-card' : ''}>
        {/*{fileType === 'image/tiff' || name.endsWith("tif") ? (*/}
        {/*    <TiffThumbnail filePath={path} />*/}
        {/*) : (*/}
            <List.Icon name={fileIcon} size='large' verticalAlign='middle' />
        {/*)}*/}
        <List.Content>
          <Dimmer.Dimmable dimmed={isDimmed}>
            <Dimmer active={isDimmed} inverted/>

            <List.Header><a href='#' onClick={onClickItem}>{name}</a>
              <Dropdown onClick={async () => setIsPublic(await checkIsPublic())}>
                <Dropdown.Menu>
                  {(isDownloader || isAdmin) && <Dropdown.Item icon='download' text='Download' disabled={isFolder} onClick={() => onDownload(isPublic)} />}
                  {/*<Dropdown.Item icon={isPublic ? 'lock' : 'unlock'} text={isPublic ? 'Make private' : 'Make public'} disabled={isFolder} onClick={() => {onSetPublic(!isPublic)}}/>*/}
                  <Dropdown.Divider/>
                  {(isAdmin) && <Dropdown.Item icon='arrow right' text='Move' disabled={isFolder} onClick={onMove} />}
                  {(isAdmin) && <Dropdown.Item icon='edit' text='Rename' onClick={onRename} />}
                  {(isAdmin) && <Dropdown.Item icon='trash' text='Delete' onClick={onDelete} />}
                </Dropdown.Menu>
              </Dropdown>
            </List.Header>
            <List.Description>
              {!isFolder && size}
              {isFolder ? 'folder' : ` \u00B7 ${fileType} `}
              {!isFolder && ` \u00B7 last modified ${lastMod} `}
            </List.Description>
          </Dimmer.Dimmable>
        </List.Content>
      </List.Item>
    )
  } else { // File card for card view
    return (
      <>
      { !isDimmed && <Card className={isFolder ? 'folder-card' : ''}>
        <Card.Content>
          <Card.Header>
            <a href='#' onClick={onClickItem}>{name}</a>
            <Dropdown onClick={async () => setIsPublic(await checkIsPublic())} icon='caret down'>
              <Dropdown.Menu>
                {/*<Dropdown.Item icon={isPublic ? 'lock' : 'unlock'} text={isPublic ? 'Make private' : 'Make public'} disabled={isFolder} onClick={() => {onSetPublic(!isPublic)}}/>*/}
                {isAdmin && <Dropdown.Item icon='arrow right' text='Move' disabled={isFolder} onClick={onMove} />}
                {isAdmin && <Dropdown.Item icon='edit' text='Rename' disabled={isFolder} onClick={onRename} />}
                {/*<Dropdown.Item icon='trash' text='Delete' onClick={onDelete} />*/}
              </Dropdown.Menu>
            </Dropdown>
          </Card.Header>
          <Card.Meta>
            {!isFolder && size}
            {isFolder ? 'folder' : ` \u00B7 ${fileType} `}
          </Card.Meta>
          <Card.Description>
            <Icon name={fileIcon}/>
            {!isFolder && ` \u00B7 last modified ${lastMod} `}
          </Card.Description>
        </Card.Content>
        <Card.Content extra>
          <Button.Group fluid>
            { !isFolder && <>
            <Button basic compact size='mini' color='green' onClick={() => onDownload(isPublic)}>
              <Icon name='download'/>
            </Button>
            <Button basic compact size='mini' color='violet' onClick={onClickItem}>
              <Icon name='linkify'/>
            </Button>
            </>}
            {isAdmin && <Button basic compact size='mini' color='red' onClick={onDelete}>
                <Icon name='trash alternate outline'/>
              </Button>
            }
          </Button.Group>
        </Card.Content>
      </Card> }
      </>
    )
  }
}

export default FileCard
