/**
 * TrguiNG - next gen remote GUI for transmission torrent daemon
 * Copyright (C) 2023  qu1ck (mail at qu1ck.org)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import "css/torrenttable.css";
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Torrent } from "rpc/torrent";
import { useServerTorrentData, useServerRpcVersion, useServerSelectedTorrents } from "rpc/torrent";
import type { TorrentAllFieldsType, TorrentFieldsType } from "rpc/transmission";
import { PriorityColors, PriorityStrings, Status, StatusStrings, TorrentMinimumFields } from "rpc/transmission";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { bytesToHumanReadableStr, modKeyString, pathMapFromServer, secondsToHumanReadableStr, timestampToDateString } from "trutil";
import { ProgressBar } from "../progressbar";
import type { AccessorFn, CellContext } from "@tanstack/table-core";
import type { TableSelectReducer } from "./common";
import { EditableNameField, TrguiTable } from "./common";
import { Badge, Box, Button, Kbd, Menu, Portal, Text } from "@mantine/core";
import { ConfigContext, ServerConfigContext } from "config";
import { StatusIconMap, Error as StatusIconError, Magnetizing, CompletedStopped } from "components/statusicons";
import { useMutateTorrentPath, useTorrentAction } from "queries";
import { notifications } from "@mantine/notifications";
import type { ContextMenuInfo } from "components/contextmenu";
import { ContextMenu, useContextMenu } from "components/contextmenu";
import type { ModalCallbacks } from "components/modals/servermodals";
import type { TorrentActionMethodsType } from "rpc/client";
import * as Icon from "react-bootstrap-icons";
import { useHotkeysContext } from "hotkeys";
const { TAURI, invoke, copyToClipboard } = await import(/* webpackChunkName: "taurishim" */"taurishim");

interface TableFieldProps {
    torrent: Torrent,
    fieldName: TorrentAllFieldsType,
}

interface TableFieldSimple {
    name: TorrentFieldsType,
    label: string,
    component: React.FunctionComponent<TableFieldProps> | React.NamedExoticComponent<TableFieldProps>,
    requiredFields?: TorrentFieldsType[],
}

interface TableFieldWithAccessor extends TableFieldSimple {
    columnId: string,
    accessorFn: AccessorFn<Torrent>,
}

type TableField = TableFieldSimple | TableFieldWithAccessor;

function isTableFieldWithAccessor(f: TableField): f is TableFieldWithAccessor {
    return (f as TableFieldWithAccessor).accessorFn !== undefined;
}

const TimeField = memo(function TimeField(props: TableFieldProps) {
    if (props.fieldName in props.torrent) {
        return <div>{secondsToHumanReadableStr(props.torrent[props.fieldName])}</div>;
    } else {
        return <></>;
    }
}, (prev, next) => {
    const previousValue = prev.torrent[prev.fieldName] as number;
    const nextValue = next.torrent[next.fieldName] as number;
    return Math.abs((previousValue - nextValue) / nextValue) < 1 / 60 / 60;
});

const AllFields: readonly TableField[] = [
    {
        name: "name",
        label: "Name",
        component: NameField,
        requiredFields: ["name", "error", "trackerStats", "leftUntilDone"] as TorrentFieldsType[],
    },
    { name: "totalSize", label: "Size", component: ByteSizeField },
    { name: "sizeWhenDone", label: "Size to download", component: ByteSizeField },
    { name: "leftUntilDone", label: "Size left", component: ByteSizeField },
    { name: "haveValid", label: "Have", component: ByteSizeField },
    { name: "downloadedEver", label: "Downloaded", component: ByteSizeField },
    { name: "uploadedEver", label: "Uploaded", component: ByteSizeField },
    {
        name: "percentDone",
        label: "Done",
        component: PercentBarField,
        requiredFields: ["percentDone", "rateDownload", "rateUpload"] as TorrentFieldsType[],
    },
    { name: "rateDownload", label: "Down speed", component: ByteRateField },
    { name: "rateUpload", label: "Up speed", component: ByteRateField },
    { name: "status", label: "Status", component: StatusField },
    { name: "addedDate", label: "Added on", component: DateField },
    {
        name: "peersSendingToUs",
        label: "Seeds",
        component: SeedsField,
        columnId: "peersSendingToUs",
        accessorFn: (t) => t.peersSendingToUs * 1e+6 + t.cachedSeedsTotal,
    },
    {
        name: "peersGettingFromUs",
        label: "Peers",
        component: PeersField,
        columnId: "peersGettingFromUs",
        accessorFn: (t) => t.peersGettingFromUs * 1e+6 + t.cachedPeersTotal,
    },
    { name: "eta", label: "ETA", component: EtaField },
    { name: "uploadRatio", label: "Ratio", component: PositiveNumberField },
    {
        name: "trackerStats",
        label: "Tracker",
        component: TrackerField,
        columnId: "tracker",
        accessorFn: (t) => t.cachedMainTracker,
    },
    {
        name: "trackerStats",
        label: "Tracker status",
        component: TrackerStatusField,
        columnId: "trackerStatus",
        accessorFn: (t) => t.cachedTrackerStatus,
    },
    { name: "doneDate", label: "Completed on", component: DateField },
    { name: "activityDate", label: "Last active", component: DateDiffField },
    { name: "downloadDir", label: "Path", component: StringField },
    { name: "bandwidthPriority", label: "Priority", component: PriorityField },
    { name: "id", label: "ID", component: StringField },
    { name: "queuePosition", label: "Queue position", component: StringField },
    { name: "secondsSeeding", label: "Seeding time", component: TimeField },
    { name: "isPrivate", label: "Private", component: StringField },
    { name: "labels", label: "Labels", component: LabelsField },
    { name: "group", label: "Bandwidth group", component: StringField },
    { name: "file-count", label: "File count", component: PositiveNumberField },
    { name: "pieceCount", label: "Piece count", component: PositiveNumberField },
    { name: "metadataPercentComplete", label: "Metadata", component: PercentBarField },
] as const;

function NameField(props: TableFieldProps) {
    let StatusIcon = StatusIconMap[props.torrent.status];
    if (props.torrent.status === Status.downloading && props.torrent.pieceCount === 0) {
        StatusIcon = Magnetizing;
    }
    if (props.torrent.status === Status.stopped &&
        props.torrent.sizeWhenDone > 0 &&
        props.torrent.leftUntilDone === 0) {
        StatusIcon = CompletedStopped;
    }

    if ((props.torrent.error !== undefined && props.torrent.error > 0) ||
        props.torrent.cachedError !== "") {
        StatusIcon = StatusIconError;
    }

    const currentName = useMemo(() => props.torrent[props.fieldName], [props.fieldName, props.torrent]);

    const mutation = useMutateTorrentPath();

    const updateTorrentName = useCallback((name: string, onStart: () => void, onEnd: () => void) => {
        onStart();

        mutation.mutate(
            { torrentId: props.torrent.id, path: props.torrent.name, name },
            {
                onSettled: onEnd,
                onError: () => { notifications.show({ color: "red", message: "Failed to rename torrent" }); },
            });
    }, [mutation, props.torrent.id, props.torrent.name]);

    const rpcVersion = useServerRpcVersion();

    return (
        <EditableNameField currentName={currentName} onUpdate={rpcVersion >= 15 ? updateTorrentName : undefined}>
            <Box pb="xs" sx={{ flexShrink: 0 }}>
                <StatusIcon />
            </Box>
        </EditableNameField>
    );
}

function StringField(props: TableFieldProps) {
    return (
        <div>
            {props.torrent[props.fieldName]}
        </div>
    );
}

function PositiveNumberField(props: TableFieldProps) {
    const num = props.torrent[props.fieldName];
    return (
        <div style={{ width: "100%", textAlign: "right" }}>
            {num < 0 ? "" : num}
        </div>
    );
}

function SeedsField(props: TableFieldProps) {
    const sending = props.torrent.peersSendingToUs as number;
    const totalSeeds = props.torrent.cachedSeedsTotal;
    return (
        <div style={{ width: "100%", textAlign: "right" }}>
            {totalSeeds < 0 ? `${sending}` : `${sending} / ${totalSeeds}`}
        </div>
    );
}

function PeersField(props: TableFieldProps) {
    const getting = props.torrent.peersGettingFromUs as number;
    const totalPeers = props.torrent.cachedPeersTotal;
    return (
        <div style={{ width: "100%", textAlign: "right" }}>
            {totalPeers < 0 ? `${getting}` : `${getting} / ${totalPeers}`}
        </div>
    );
}

export function EtaField(props: TableFieldProps) {
    const seconds = props.torrent[props.fieldName];
    if (seconds >= 0) return <TimeField {...props} />;
    else if (seconds === -1) return <></>;
    else return <div>∞</div>;
}

export function TrackerField(props: TableFieldProps) {
    return <div>{props.torrent.cachedMainTracker}</div>;
}

function TrackerStatusField(props: TableFieldProps) {
    return <div>{props.torrent.cachedTrackerStatus}</div>;
}

function PriorityField(props: TableFieldProps) {
    const priority = props.torrent[props.fieldName];
    return <Badge radius="md" variant="filled" bg={PriorityColors.get(priority)}>{PriorityStrings.get(priority)}</Badge>;
}

export function LabelsField(props: TableFieldProps) {
    const labels: string[] | undefined = props.torrent.labels;
    return <>
        {labels?.map((label) => <Badge key={label}
            radius="md" variant="filled" className="torrent-label white-outline">
            {label}
        </Badge>)}
    </>;
}

export function StatusField(props: TableFieldProps) {
    let status: string = StatusStrings[props.torrent.status];
    if (props.torrent.status === Status.downloading && props.torrent.pieceCount === 0) status = "Magnetizing";

    const sequential = (props.torrent.status === Status.downloading && props.torrent.sequentialDownload === true) ? " sequentially" : "";
    return <div>{status + sequential}</div>;
}

export function DateField(props: TableFieldProps) {
    const date = props.torrent[props.fieldName] > 0
        ? timestampToDateString(props.torrent[props.fieldName])
        : "";
    return <div>{date}</div>;
}

export function DateDiffField(props: TableFieldProps) {
    const date = props.torrent[props.fieldName] > 0
        ? timestampToDateString(props.torrent[props.fieldName])
        : "";
    const seconds = Math.floor(Date.now() / 1000) - props.torrent[props.fieldName];
    return <div title={date} style={{ width: "100%", textAlign: "right" }}>
        {seconds < 30
            ? "now"
            : date === "" ? "" : `${secondsToHumanReadableStr(seconds)} ago`}
    </div>;
}

function ByteSizeField(props: TableFieldProps) {
    const field = props.torrent[props.fieldName];
    const stringValue = useMemo(() => {
        return bytesToHumanReadableStr(field);
    }, [field]);

    return <div style={{ width: "100%", textAlign: "right" }}>{stringValue}</div>;
}

function ByteRateField(props: TableFieldProps) {
    const field = props.torrent[props.fieldName];
    const stringValue = useMemo(() => {
        return field > 0 ? `${bytesToHumanReadableStr(field)}/s` : "";
    }, [field]);

    return <div style={{ width: "100%", textAlign: "right" }}>{stringValue}</div>;
}

function PercentBarField(props: TableFieldProps) {
    let now: number = props.torrent[props.fieldName] * 100;
    let label: string = '';
    let status: number = props.torrent.status;
    if ((props.torrent.error !== undefined && props.torrent.error > 0) || props.torrent.cachedError !== "") {
        status = Status.error;
    } else if (props.torrent.status === Status.downloading && props.torrent.pieceCount === 0) {
        now = 100;
        label = "🧲";
        status = Status.magnetizing;
    }
    const active = props.torrent.rateDownload > 0 || props.torrent.rateUpload > 0;

    return <ProgressBar
        now={now}
        className="white-outline"
        label={label}
        animate={active}
        status={status} />;
}

const Columns = AllFields.map((f): ColumnDef<Torrent> => {
    const cell = (props: CellContext<Torrent, unknown>) => {
        return <f.component fieldName={f.name} torrent={props.row.original} />;
    };
    if (isTableFieldWithAccessor(f)) {
        return {
            header: f.label,
            accessorFn: f.accessorFn,
            id: f.columnId,
            cell,
        };
    }
    return {
        header: f.label,
        accessorKey: f.name,
        cell,
    };
});

const ColumnRequiredFields = AllFields.map(
    (f) => ({
        id: (f as TableFieldWithAccessor).columnId ?? f.name,
        requires: f.requiredFields ?? [f.name],
    }),
);

function getRequiredFields(visibilityState: VisibilityState): TorrentFieldsType[] {
    const set = ColumnRequiredFields.reduce(
        (set: Set<TorrentFieldsType>, f) => {
            if (!(f.id in visibilityState) || visibilityState[f.id]) {
                f.requires.forEach((r) => set.add(r));
            }
            return set;
        },
        new Set<TorrentFieldsType>());

    // add bare minimum fields
    TorrentMinimumFields.forEach((f) => set.add(f));
    if (TAURI) set.add("hashString");

    return Array.from(set).sort();
}

export function useInitialTorrentRequiredFields() {
    const config = useContext(ConfigContext);

    return useMemo(
        () => getRequiredFields(config.getTableColumnVisibility("torrents")),
        [config]);
}

export function TorrentTable(props: {
    modals: React.RefObject<ModalCallbacks>,
    torrents: Torrent[],
    setCurrentTorrent: (id: string) => void,
    selectedTorrents: Set<number>,
    selectedReducer: TableSelectReducer,
    onColumnVisibilityChange: React.Dispatch<TorrentFieldsType[]>,
    scrollToRow?: { id: string },
}) {
    const serverConfig = useContext(ServerConfigContext);

    const getRowId = useCallback((t: Torrent) => String(t.id), []);

    const { onColumnVisibilityChange } = props;
    const onVisibilityChange = useCallback(
        (visibility: VisibilityState) => { onColumnVisibilityChange(getRequiredFields(visibility)); },
        [onColumnVisibilityChange],
    );

    const onRowDoubleClick = useCallback((torrent: Torrent) => {
        if (TAURI) {
            if (torrent.downloadDir === undefined || torrent.downloadDir === "") return;
            let path = torrent.downloadDir as string;
            if (!path.endsWith("/") && !path.endsWith("\\")) {
                path = path + "/";
            }
            path = path + (torrent.name as string);
            path = pathMapFromServer(path, serverConfig);
            invoke("shell_open", { path }).catch((e) => {
                notifications.show({
                    title: "Error opening path",
                    message: path,
                    color: "red",
                });
            });
        } else {
            props.modals.current?.editTorrent();
        }
    }, [props.modals, serverConfig]);

    const serverSelected = useServerSelectedTorrents();
    const selected = useMemo(() => Array.from(serverSelected).map(String), [serverSelected]);

    const [info, setInfo, handler] = useContextMenu();

    return (
        <Box w="100%" h="100%" onContextMenu={handler}>
            <MemoizedTorrentContextMenu
                contextMenuInfo={info}
                setContextMenuInfo={setInfo}
                modals={props.modals}
                onRowDoubleClick={onRowDoubleClick} />
            <TrguiTable<Torrent> {...{
                tablename: "torrents",
                columns: Columns,
                data: props.torrents,
                getRowId,
                selected,
                selectedReducer: props.selectedReducer,
                setCurrent: props.setCurrentTorrent,
                onVisibilityChange,
                onRowDoubleClick,
                scrollToRow: props.scrollToRow,
            }} />
        </Box>
    );
}

function TorrentContextMenu(props: {
    contextMenuInfo: ContextMenuInfo,
    setContextMenuInfo: (i: ContextMenuInfo) => void,
    modals: React.RefObject<ModalCallbacks>,
    onRowDoubleClick: (t: Torrent) => void,
}) {
    const serverData = useServerTorrentData();
    const serverSelected = useServerSelectedTorrents();

    const { onRowDoubleClick } = props;
    const onOpen = useCallback(() => {
        const [id] = [...serverSelected];
        const torrent = serverData.torrents.find((t) => t.id === id);
        if (torrent === undefined) return;
        onRowDoubleClick(torrent);
    }, [onRowDoubleClick, serverData.torrents, serverSelected]);

    const mutation = useTorrentAction();

    const torrentAction = useCallback((method: TorrentActionMethodsType, successMessage: string) => {
        mutation.mutate(
            {
                method,
                torrentIds: Array.from(serverSelected),
            },
            {
                onSuccess: () => {
                    notifications.show({
                        message: successMessage,
                        color: "green",
                    });
                },
            },
        );
    }, [mutation, serverSelected]);

    const [queueSubmenuOpened, setQueueSubmenuOpened] = useState(false);
    const queueRef = useRef<HTMLButtonElement>(null);
    const [queueItemRect, setQueueItemRect] = useState<DOMRect>(() => new DOMRect(0, -100, 0, 0));

    const openQueueSubmenu = useCallback(() => {
        if (queueRef.current == null || serverSelected.size === 0) return;
        setQueueItemRect(queueRef.current.getBoundingClientRect());
        setQueueSubmenuOpened(true);
    }, [serverSelected]);

    const closeQueueSubmenu = useCallback(() => {
        setQueueSubmenuOpened(false);
        setQueueItemRect(new DOMRect(0, -100, 0, 0));
    }, []);

    const copyMagnetLinks = useCallback(() => {
        if (serverSelected.size === 0) return;

        const links = serverData.torrents
            .filter((t) => serverSelected.has(t.id))
            .map((t) => t.magnetLink);

        copyToClipboard(links.join("\n"));

        notifications.show({
            message: `Magnet ${serverSelected.size > 1 ? "links" : "link"} copied to clipboard`,
            color: "green",
        });
    }, [serverData.torrents, serverSelected]);

    const hk = useHotkeysContext();

    useEffect(() => {
        hk.handlers.copyToClipboard = copyMagnetLinks;
        return () => { hk.handlers.copyToClipboard = () => { }; };
    }, [copyMagnetLinks, hk]);

    return (<>
        <Menu
            openDelay={100}
            closeDelay={400}
            opened={queueSubmenuOpened}
            onChange={setQueueSubmenuOpened}
            middlewares={{ shift: true, flip: true }}
            position="right-start"
            zIndex={301}
        >
            <Portal>
                <Box
                    onMouseDown={closeQueueSubmenu}
                    sx={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        height: "100vh",
                        width: "100vw",
                        zIndex: queueSubmenuOpened ? 100 : -1,
                    }} />
                <Menu.Target>
                    <Button unstyled
                        sx={{
                            position: "absolute",
                            border: 0,
                            padding: 0,
                            background: "transparent",
                        }}
                        style={{
                            left: queueItemRect.x,
                            top: queueItemRect.y,
                            width: `calc(${queueItemRect.width}px + 0.5em)`,
                            height: queueItemRect.height,
                        }} />
                </Menu.Target>
                <Menu.Dropdown miw="10rem">
                    <Menu.Item
                        onClick={() => { torrentAction("queue-move-top", "Torrents queue updated"); }}
                        icon={<Icon.ChevronDoubleUp size="1.1rem" />}>
                        Move to top
                    </Menu.Item>
                    <Menu.Item
                        onClick={() => { torrentAction("queue-move-up", "Torrents queue updated"); }}
                        icon={<Icon.ChevronUp size="1.1rem" />}>
                        Move up
                    </Menu.Item>
                    <Menu.Item
                        onClick={() => { torrentAction("queue-move-down", "Torrents queue updated"); }}
                        icon={<Icon.ChevronDown size="1.1rem" />}>
                        Move down
                    </Menu.Item>
                    <Menu.Item
                        onClick={() => { torrentAction("queue-move-bottom", "Torrents queue updated"); }}
                        icon={<Icon.ChevronDoubleDown size="1.1rem" />}>
                        Move to bottom
                    </Menu.Item>
                </Menu.Dropdown>
            </Portal>
        </Menu>
        <ContextMenu contextMenuInfo={props.contextMenuInfo} setContextMenuInfo={props.setContextMenuInfo}>
            <Box miw="14rem">
                {TAURI && <>
                    <Menu.Item
                        onClick={onOpen}
                        onMouseEnter={closeQueueSubmenu}
                        icon={<Icon.BoxArrowUpRight size="1.1rem" />}
                        disabled={serverSelected.size !== 1}>
                        <Text weight="bold">Open</Text>
                    </Menu.Item>
                    <Menu.Divider />
                </>}
                <Menu.Item
                    onClick={() => { torrentAction("torrent-start-now", "Torrents started"); }}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.LightningFill size="1.1rem" />}
                    disabled={serverSelected.size === 0}>
                    Force start
                </Menu.Item>
                <Menu.Item
                    onClick={() => { torrentAction("torrent-verify", "Torrents verification started"); }}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.CheckAll size="1.1rem" />}
                    disabled={serverSelected.size === 0}>
                    Verify
                </Menu.Item>
                <Menu.Item
                    onClick={() => { torrentAction("torrent-reannounce", "Torrents are reannounced"); }}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.Wifi size="1.1rem" />}
                    disabled={serverSelected.size === 0}>
                    Reannounce
                </Menu.Item>
                <Menu.Item
                    onClick={copyMagnetLinks}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.MagnetFill size="1.1rem" />}
                    disabled={serverSelected.size === 0}
                    rightSection={<Kbd>{`${modKeyString()} C`}</Kbd>}>
                    Copy magnet {serverSelected.size > 1 ? "links" : "link"}
                </Menu.Item>
                <Menu.Item ref={queueRef}
                    icon={<Icon.ThreeDots size="1.1rem" />}
                    rightSection={<Icon.ChevronRight size="0.8rem" />}
                    onMouseEnter={openQueueSubmenu}
                    disabled={serverSelected.size === 0}>
                    Queue
                </Menu.Item>
                <Menu.Item
                    onClick={() => props.modals.current?.move()}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.FolderFill size="1.1rem" />}
                    disabled={serverSelected.size === 0}
                    rightSection={<Kbd>F6</Kbd>}>
                    Move...
                </Menu.Item>
                <Menu.Item
                    onClick={() => props.modals.current?.setLabels()}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.TagsFill size="1.1rem" />}
                    disabled={serverSelected.size === 0}
                    rightSection={<Kbd>F7</Kbd>}>
                    Set labels...
                </Menu.Item>
                <Menu.Item
                    onClick={() => props.modals.current?.remove()}
                    onMouseEnter={closeQueueSubmenu}
                    icon={<Icon.XCircleFill color="red" size="1.1rem" />}
                    disabled={serverSelected.size === 0}
                    rightSection={<Kbd>del</Kbd>}>
                    Remove...
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                    onClick={() => props.modals.current?.editTorrent()}
                    icon={<Icon.GearFill size="1.1rem" />}
                    onMouseEnter={closeQueueSubmenu}
                    disabled={serverSelected.size !== 1}>
                    Properties...
                </Menu.Item>
            </Box>
        </ContextMenu>
    </>);
}

const MemoizedTorrentContextMenu = memo(TorrentContextMenu);
