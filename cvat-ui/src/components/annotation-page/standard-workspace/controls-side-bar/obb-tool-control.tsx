// Copyright (C) Bovision Pty Ltd
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { connect } from 'react-redux';
import Icon from '@ant-design/icons';

import { AIToolsIcon } from 'icons';
import { Canvas } from 'cvat-canvas-wrapper';
import { CombinedState, ActiveControl } from 'reducers';
import { MLModel } from 'cvat-core-wrapper';
import { interactWithCanvas } from 'actions/annotation-actions';
import CVATTooltip from 'components/common/cvat-tooltip';

interface StateToProps {
    canvasInstance: Canvas;
    activeControl: ActiveControl;
    interactors: MLModel[];
    labelID: number | null;
}

interface DispatchToProps {
    onInteractionStart: typeof interactWithCanvas;
}

function mapStateToProps(state: CombinedState): StateToProps {
    const {
        annotation: {
            canvas: { instance, activeControl },
            drawing: { activeLabelID },
            job: { labels },
        },
        models: { interactors },
    } = state;
    return {
        canvasInstance: instance as Canvas,
        activeControl,
        interactors,
        labelID: activeLabelID ?? (labels.length ? (labels[0].id as number) : null),
    };
}

const mapDispatchToProps: DispatchToProps = {
    onInteractionStart: interactWithCanvas,
};

// Dedicated single-click OBB tool. Starts the SAM point-interaction directly; the mounted
// ToolsControl runs SAM inference and converts the mask to an editable oriented box (its
// default interactor is SAM and "Build OBB" is on). This is just a shortcut to that flow.
function OBBToolControl(props: StateToProps & DispatchToProps): JSX.Element {
    const {
        canvasInstance, activeControl, interactors, labelID, onInteractionStart,
    } = props;

    const sam = interactors.find(
        (m: MLModel) => /sam|segment anything/i.test(`${m.id} ${m.name}`),
    ) ?? (interactors.length ? interactors[0] : null);
    const disabled = !sam || labelID === null;
    const active = activeControl === ActiveControl.AI_TOOLS;

    const onClick = (): void => {
        if (!sam || labelID === null) return;
        const parameters = {
            command: 'draw_points' as const,
            settings: {
                appendCursorPositionAsPoint: false,
                removalStrategy: 'any' as const,
                points_type: 'any' as const,
                crosshair: false,
            },
        };
        canvasInstance.cancel();
        canvasInstance.interact({ enabled: true, ...parameters });
        onInteractionStart(sam, labelID, parameters);
    };

    return (
        <CVATTooltip
            title={disabled ? 'Single-click OBB — SAM unavailable' : 'Single-click OBB (SAM)'}
            placement='right'
        >
            <Icon
                component={AIToolsIcon}
                className={
                    `cvat-tools-control cvat-obb-tool-control${active ? ' cvat-active-canvas-control' : ''}` +
                    `${disabled ? ' cvat-disabled-canvas-control' : ''}`
                }
                onClick={disabled ? undefined : onClick}
            />
        </CVATTooltip>
    );
}

Object.assign(OBBToolControl, { displayName: 'OBBToolControl' });
export default connect(mapStateToProps, mapDispatchToProps)(React.memo(OBBToolControl));
