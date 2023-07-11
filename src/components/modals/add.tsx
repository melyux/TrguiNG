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

import { Box, Button, Checkbox, Divider, Flex, Group, Menu, Overlay, SegmentedControl, Text, TextInput, useMantineTheme } from "@mantine/core";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ActionModalState, LabelsData, LocationData } from "./common";
import { HkModal, TorrentLabels, TorrentLocation, limitTorrentNames, useTorrentLocation } from "./common";
import type { PriorityNumberType } from "rpc/transmission";
import { PriorityColors, PriorityStrings } from "rpc/transmission";
import type { Torrent } from "rpc/torrent";
import { CachedFileTree } from "cachedfiletree";
import { FileTreeTable, useUnwantedFiles } from "components/tables/filetreetable";
import { notifications } from "@mantine/notifications";
import type { TorrentAddQueryParams } from "queries";
import { useAddTorrent, useFileTree } from "queries";
import { ConfigContext, ServerConfigContext } from "config";
import type { ServerTabsRef } from "components/servertabs";
const { TAURI, dialogOpen, invoke } = await import(/* webpackChunkName: "taurishim" */"taurishim");

interface AddCommonProps extends React.PropsWithChildren {
    location: LocationData,
    labelsData: LabelsData,
    start: boolean,
    setStart: (b: boolean) => void,
    priority: PriorityNumberType,
    setPriority: (p: PriorityNumberType) => void,
}

function AddCommon(props: AddCommonProps) {
    return <>
        <TorrentLocation {...props.location} inputLabel="Download directory" />
        <TorrentLabels {...props.labelsData} inputLabel="Labels" />
        <Group>
            <Checkbox
                label="Start torrent"
                checked={props.start}
                onChange={(e) => { props.setStart(e.currentTarget.checked); }}
                my="xl"
                styles={{ root: { flexGrow: 1 } }} />
            {props.children}
            <SegmentedControl
                color={PriorityColors.get(props.priority)}
                value={String(props.priority)}
                onChange={(value) => { props.setPriority(+value as PriorityNumberType); }}
                data={Array.from(PriorityStrings.entries()).map(([k, v]) => ({
                    value: String(k),
                    label: v,
                }))} />
        </Group>
    </>;
}

interface AddCommonModalProps extends ActionModalState {
    serverName: string,
    uri: string | File | undefined,
    tabsRef: React.RefObject<ServerTabsRef>,
}

function useCommonProps(modalProps: AddCommonModalProps) {
    const location = useTorrentLocation();
    const [labels, setLabels] = useState<string[]>([]);
    const [labelsData, setLabelData] = useState<LabelsData>({
        labels,
        setLabels,
        allLabels: modalProps.serverData.current.allLabels,
    });
    const [start, setStart] = useState<boolean>(true);
    const [priority, setPriority] = useState<PriorityNumberType>(0);

    useEffect(() => {
        setLabelData({
            labels,
            setLabels,
            allLabels: modalProps.serverData.current.allLabels,
        });
    }, [labels, modalProps.opened, modalProps.serverData]);

    const props = useMemo<AddCommonProps>(() => ({
        location,
        labelsData,
        start,
        setStart,
        priority,
        setPriority,
    }), [location, labelsData, start, priority]);

    return {
        location,
        labels,
        start,
        priority,
        props,
    };
}

function TabSwitchDropdown({ tabsRef }: { tabsRef: React.RefObject<ServerTabsRef> }) {
    const serverConfig = useContext(ServerConfigContext);

    const [value, setValue] = useState(serverConfig.name);

    useEffect(() => {
        setValue(serverConfig.name);
    }, [serverConfig]);

    const onChange = useCallback((value: string) => {
        setValue(value);
        const tabIndex = tabsRef.current?.getOpenTabs().findIndex((v) => v === value);
        if (tabIndex !== undefined) tabsRef.current?.switchTab(tabIndex);
    }, [tabsRef]);

    return (
        tabsRef.current == null
            ? <></>
            : <Menu shadow="md" width={200} position="bottom-start">
                <Menu.Target>
                    <Button variant="subtle" title="Switch server">
                        {value}
                    </Button>
                </Menu.Target>

                <Menu.Dropdown>
                    {tabsRef.current.getOpenTabs().map((tab) =>
                        <Menu.Item key={tab} onClick={() => { onChange(tab); }}>{tab}</Menu.Item>)
                    }
                </Menu.Dropdown>
            </Menu>
    );
}

export function AddMagnet(props: AddCommonModalProps) {
    const [magnet, setMagnet] = useState<string>("");

    useEffect(() => {
        if (props.opened) {
            if (typeof props.uri === "string") setMagnet(props.uri);
            else setMagnet("");
        }
    }, [props.uri, props.opened]);

    const common = useCommonProps(props);
    const { close } = props;
    const mutation = useAddTorrent(
        useCallback((response: any) => {
            const duplicate = response.arguments["torrent-duplicate"];
            if (duplicate !== undefined) {
                notifications.show({
                    title: "Torrent already exists",
                    message: duplicate.name,
                    color: "green",
                });
            }
            const added = response.arguments["torrent-added"];
            if (added !== undefined) {
                notifications.show({
                    title: "Torrent added",
                    message: added.name,
                    color: "green",
                });
            }
        }, []),
        useCallback((e) => {
            console.error("Failed to add torrent:", e);
            notifications.show({
                title: "Error adding torrent",
                message: String(e),
                color: "red",
            });
        }, []),
    );

    const onAdd = useCallback(() => {
        mutation.mutate(
            {
                url: magnet,
                downloadDir: common.location.path,
                labels: common.labels,
                paused: !common.start,
                priority: common.priority,
            },
        );
        common.location.addPath(common.location.path);
        close();
    }, [mutation, magnet, common.location, common.labels, common.start, common.priority, close]);

    return (
        <HkModal opened={props.opened} onClose={close} centered size="lg"
            styles={{ title: { flexGrow: 1 } }}
            title={<Flex w="100%" align="center" justify="space-between">
                <span>Add torrent by magnet link or URL</span>
                {TAURI && <TabSwitchDropdown tabsRef={props.tabsRef} />}
            </Flex>} >
            <Divider my="sm" />
            <TextInput
                label="Link" w="100%"
                value={magnet}
                onChange={(e) => { setMagnet(e.currentTarget.value); }} />
            <AddCommon {...common.props} />
            <Divider my="sm" />
            <Group position="center" spacing="md">
                <Button onClick={onAdd} variant="filled">Add</Button>
                <Button onClick={props.close} variant="light">Cancel</Button>
            </Group>
        </HkModal>
    );
}

async function readLocalTorrent(file: File): Promise<string> {
    return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const b64 = (reader.result as string).match(/data:[^/]*\/[^;]*;base64,(.*)/)?.[1];
            if (b64 === undefined) {
                throw Error("Error reading file");
            }
            resolve(b64);
        };
        reader.readAsDataURL(file);
    });
}

function useFilesInput(
    filesInputRef: React.RefObject<HTMLInputElement>,
    close: () => void,
    setTorrentData: React.Dispatch<TorrentFileData[] | undefined>,
) {
    useEffect(() => {
        const input = filesInputRef.current;
        const fileInputListener = (e: Event) => {
            const element = e.target as HTMLInputElement;
            if (element.files == null) {
                close();
            } else {
                const files = [...element.files];
                Promise.all(files.map(readLocalTorrent)).then((filesData) => {
                    setTorrentData(filesData.map((b64, i) => ({
                        torrentPath: "",
                        metadata: b64,
                        name: files[i].name,
                        hash: "",
                        files: null,
                    })));
                }).catch((e) => {
                    notifications.show({
                        title: "Error reading file",
                        message: e,
                        color: "red",
                    });
                    close();
                });
            }
        };

        if (!TAURI) {
            input?.addEventListener("change", fileInputListener);
        }
        return () => {
            if (!TAURI) input?.removeEventListener("change", fileInputListener);
        };
    }, [close, filesInputRef, setTorrentData]);
}

interface TorrentFileData {
    torrentPath: string,
    metadata: string,
    name: string,
    hash: string,
    files: Array<{
        name: string,
        length: number,
    }> | null,
}

export function AddTorrent(props: AddCommonModalProps) {
    const config = useContext(ConfigContext);
    const common = useCommonProps(props);
    const [torrentData, setTorrentData] = useState<TorrentFileData[]>();

    const filesInputRef = useRef<HTMLInputElement>(null);

    const { close } = props;

    useFilesInput(filesInputRef, close, setTorrentData);

    const [existingTorrent, setExistingTorrent] = useState<Torrent>();

    useEffect(() => {
        if (torrentData !== undefined && torrentData.length === 1) {
            const torrent = props.serverData.current?.torrents.find((t) => t.hashString === torrentData[0].hash);
            setExistingTorrent(torrent);
        }
    }, [props.serverData, props.serverName, torrentData]);

    useEffect(() => {
        if (!TAURI && props.opened) {
            if (props.uri === undefined) {
                if (filesInputRef.current != null) {
                    filesInputRef.current.value = "";
                    filesInputRef.current.click();
                }
                close();
            } else {
                const file = props.uri as File;
                readLocalTorrent(file).then((b64) => {
                    setTorrentData([{
                        torrentPath: "",
                        metadata: b64,
                        name: file.name,
                        hash: "",
                        files: null,
                    }]);
                }).catch(() => {
                    notifications.show({
                        title: "Error reading file",
                        message: file.name,
                        color: "red",
                    });
                    close();
                });
            }
        }
    }, [props.opened, props.uri, close]);

    useEffect(() => {
        if (TAURI && props.opened && torrentData === undefined) {
            const readFile = async (path: string | string[] | null) => {
                if (path == null) {
                    return undefined;
                }
                if (Array.isArray(path)) {
                    return await Promise.all(path.map(
                        async (p) => await invoke<TorrentFileData>("read_file", { path: p })));
                }
                return [await invoke<TorrentFileData>("read_file", { path })];
            };

            let uri = props.uri;
            if (typeof uri === "string" && uri.startsWith("file://")) {
                uri = decodeURIComponent(uri.substring(7));
            }

            const pathPromise = typeof uri === "string"
                ? Promise.resolve(uri)
                : dialogOpen({
                    title: "Select torrent file",
                    filters: [{
                        name: "Torrent",
                        extensions: ["torrent"],
                    }],
                    multiple: true,
                });

            pathPromise.then(readFile)
                .then((torrentData) => {
                    setTorrentData(torrentData);
                    if (torrentData === undefined) {
                        props.close();
                    }
                }).catch((e) => {
                    notifications.show({
                        title: "Error reading torrent",
                        message: String(e),
                        color: "red",
                    });
                    props.close();
                });
        }
    }, [props, torrentData]);

    const fileTree = useMemo(() => new CachedFileTree(torrentData?.[0]?.hash ?? "", -1), [torrentData]);

    const { data, refetch } = useFileTree("filetreebrief", fileTree);
    useEffect(() => {
        if (torrentData !== undefined && torrentData.length === 1 && torrentData[0].files != null) {
            fileTree.parse(torrentData[0], true);
            void refetch();
        }
    }, [torrentData, fileTree, refetch]);

    const onCheckboxChange = useUnwantedFiles(fileTree, false);

    const setAllWanted = useCallback((wanted: boolean) => {
        onCheckboxChange(fileTree.tree, wanted);
        void refetch();
    }, [fileTree, onCheckboxChange, refetch]);

    const addMutation = useAddTorrent(
        useCallback((response: any, vars: TorrentAddQueryParams) => {
            const duplicate = response.arguments["torrent-duplicate"];
            if (duplicate !== undefined) {
                notifications.show({
                    title: "Torrent already exists",
                    message: duplicate.name,
                    color: "green",
                });
            }
            const added = response.arguments["torrent-added"];
            if (added !== undefined) {
                notifications.show({
                    title: "Torrent added",
                    message: added.name,
                    color: "green",
                });
            }
            if (TAURI && config.values.app.deleteAdded && vars.filePath !== undefined) {
                void invoke("remove_file", { path: vars.filePath });
            }
        }, [config.values.app.deleteAdded]),
        useCallback((e) => {
            console.error("Failed to add torrent:", e);
            notifications.show({
                title: "Error adding torrent",
                message: String(e),
                color: "red",
            });
        }, []),
    );

    const onAdd = useCallback(() => {
        if (torrentData === undefined) return;

        void Promise.all(torrentData.map(async (td) => {
            return await addMutation.mutateAsync(
                {
                    metainfo: td.metadata,
                    downloadDir: common.location.path,
                    labels: common.labels,
                    paused: !common.start,
                    priority: common.priority,
                    unwanted: (td.files == null || torrentData.length > 1) ? undefined : fileTree.getUnwanted(),
                    filePath: td.torrentPath,
                },
            );
        }));

        common.location.addPath(common.location.path);
        setTorrentData(undefined);
        close();
    }, [addMutation, close, torrentData, common, fileTree]);

    const modalClose = useCallback(() => {
        setTorrentData(undefined);
        close();
    }, [close]);

    const names = useMemo(() => {
        if (torrentData === undefined) return [];

        const names = torrentData.map((td) => td.name);

        return limitTorrentNames(names, 1);
    }, [torrentData]);

    const torrentExists = existingTorrent !== undefined;

    const theme = useMantineTheme();

    return (<>
        {!TAURI && <input ref={filesInputRef} type="file" accept=".torrent" multiple
            style={{ position: "absolute", top: "-20rem", zIndex: -1 }} />}
        {torrentData === undefined
            ? <></>
            : <HkModal opened={torrentData !== undefined} onClose={modalClose} centered size="lg"
                styles={{ title: { flexGrow: 1 } }}
                title={<Flex w="100%" align="center" justify="space-between">
                    <span>Add torrent</span>
                    {TAURI && <TabSwitchDropdown tabsRef={props.tabsRef} />}
                </Flex>} >
                <Divider my="sm" />
                {names.map((name, i) => <Text key={i}>{name}</Text>)}
                <div style={{ position: "relative" }}>
                    {torrentExists &&
                        <Overlay
                            opacity={0.6} blur={3}
                            color={theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.white}>
                            <Flex align="center" justify="center" h="100%">
                                <Text color="red" fw="bold" fz="lg">Torrent already exists</Text>
                            </Flex>
                        </Overlay>}
                    <AddCommon {...common.props}>
                        {(torrentData.length > 1 || torrentData[0].files == null)
                            ? <></>
                            : <>
                                <Button variant="subtle" onClick={() => { setAllWanted(true); }} title="Mark all files wanted">All</Button>
                                <Button variant="subtle" onClick={() => { setAllWanted(false); }} title="Mark all files unwanted">None</Button>
                            </>
                        }
                    </AddCommon>
                    {(torrentData.length > 1 || torrentData[0].files == null)
                        ? <></>
                        : <Box w="100%" h="15rem">
                            <FileTreeTable
                                fileTree={fileTree}
                                data={data}
                                brief
                                onCheckboxChange={onCheckboxChange} />
                        </Box>
                    }
                </div>
                <Divider my="sm" />
                <Group position="center" spacing="md">
                    <Button onClick={onAdd} variant="filled" disabled={torrentExists}>Add</Button>
                    <Button onClick={modalClose} variant="light">Cancel</Button>
                </Group>
            </HkModal >}
    </>);
}
