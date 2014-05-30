// Copyright 2014 Todd Fleming
//
// This file is part of jscut.
//
// jscut is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// jscut is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with jscut.  If not, see <http://www.gnu.org/licenses/>.

var Path = new function () {
    Path = this;
    Path.svgPxPerInch = 90;
    Path.snapToClipperScale = 100000;                                           // Scale Snap.svg to Clipper
    Path.cleanPolyDist = Path.snapToClipperScale * Path.svgPxPerInch / 100000;  // 1/100000 in
    Path.arcTolerance = Path.snapToClipperScale * Path.svgPxPerInch / 40000;    // 1/40000 in

    // Linearize a cubic bezier. Returns ['L', x2, y2, x3, y3, ...]. The return value doesn't
    // include (p1x, p1y); it's part of the previous segment.
    function linearizeCubicBezier(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, minNumSegments, minSegmentLength) {
        function bez(p0, p1, p2, p3, t) {
            return (1 - t) * (1 - t) * (1 - t) * p0 + 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t * p3;
        }

        if (p1x == c1x && p1y == c1y && p2x == c2x && p2y == c2y)
            return ['L', p2x, p2y];

        var numSegments = minNumSegments;
        while (true) {
            var x = p1x;
            var y = p1y;
            var result = ['L'];
            for (var i = 1; i <= numSegments; ++i) {
                t = 1.0 * i / numSegments;
                var nextX = bez(p1x, c1x, c2x, p2x, t);
                var nextY = bez(p1y, c1y, c2y, p2y, t);
                if ((nextX - x) * (nextX - x) + (nextY - y) * (nextY - y) > minSegmentLength * minSegmentLength) {
                    numSegments *= 2;
                    result = null;
                    break;
                }
                result.push(nextX, nextY);
                x = nextX;
                y = nextY;
            }
            if (result)
                return result;
        }
    }

    // Linearize a path. Both the input path and the returned path are in snap.svg's format.
    // Calls alertFn with an error message and returns null if there's a problem.
    Path.linearizeSnapPath = function (path, minNumSegments, minSegmentLength, alertFn) {
        if (path.length < 2 || path[0].length != 3 || path[0][0] != 'M') {
            alertFn("Path does not begin with M")
            return null;
        }
        var x = path[0][1];
        var y = path[0][2];
        var result = [path[0]];
        for (var i = 1; i < path.length; ++i) {
            subpath = path[i];
            if (subpath[0] == 'C' && subpath.length == 7) {
                result.push(linearizeCubicBezier(
                    x, y, subpath[1], subpath[2], subpath[3], subpath[4], subpath[5], subpath[6], minNumSegments, minSegmentLength));
                x = subpath[5];
                y = subpath[6];
            } else if (subpath[0] == 'M' && subpath.length == 3) {
                result.push(subpath);
                x = subpath[1];
                y = subpath[2];
            } else {
                alertFn("Subpath has an unknown prefix: " + subpath[0]);
                return null;
            }
        }
        return result;
    };

    // Get a linear path from an element in snap.svg's format. Calls alertFn with an 
    // error message and returns null if there's a problem. Returns null without calling
    // alertFn if element.type == "svg".
    Path.getLinearSnapPathFromElement = function (element, minNumSegments, minSegmentLength, alertFn) {
        var path = null;

        if (element.type == "svg")
            return null;
        else if (element.type == "path")
            path = element.attr("d");
        else {
            alertFn(element.type + " is not supported; try Inkscape's <strong>Object to Path</strong> command");
            return null;
        }

        if (element.attr('clip-path') != "none") {
            alertFn("clip-path is not supported");
            return null;
        }

        if (element.attr('mask') != "none") {
            alertFn("mask is not supported");
            return null;
        }

        if (path == null) {
            alertFn("path is missing");
            return;
        }

        path = Snap.path.map(path, element.transform().globalMatrix);
        path = Snap.parsePathString(path);
        path = Path.linearizeSnapPath(path, minNumSegments, minSegmentLength, alertFn);
        return path;
    };

    Path.getClipperPointFromSnapPoint = function (x, y) {
        return {
            X: Math.round(x * Path.snapToClipperScale),
            Y: Math.round(y * Path.snapToClipperScale)
        };
    };

    // Convert a path in snap.svg format to Clipper format. May return multiple
    // paths. Only supports linear paths. Calls alertFn with an error message
    // and returns null if there's a problem.
    Path.getClipperPathsFromSnapPath = function (path, alertFn) {
        if (path.length < 2 || path[0].length != 3 || path[0][0] != 'M') {
            alertFn("Path does not begin with M");
            return null;
        }
        var currentPath = [Path.getClipperPointFromSnapPoint(path[0][1], path[0][2])];
        var result = [currentPath];
        for (var i = 1; i < path.length; ++i) {
            subpath = path[i];
            if (subpath[0] == 'M' && subpath.length == 3) {
                currentPath = [Path.getClipperPointFromSnapPoint(subpath[1], subpath[2])];
                result.push(currentPath);
            } else if (subpath[0] == 'L') {
                for (var j = 0; j < (subpath.length - 1) / 2; ++j)
                    currentPath.push(Path.getClipperPointFromSnapPoint(subpath[1 + j * 2], subpath[2 + j * 2]));
            } else {
                alertFn("Subpath has a non-linear prefix: " + subpath[0]);
                return null;
            }
        }
        return result;
    };

    function pushSnapPointFromClipperPoint(a, p) {
        a.push(p.X * 1.0 / Path.snapToClipperScale);
        a.push(p.Y * 1.0 / Path.snapToClipperScale);
    }

    // Convert a set of Clipper paths to a single snap.svg path.
    Path.getSnapPathFromClipperPaths = function (path) {
        var result = [];
        for (var i = 0; i < path.length; ++i) {
            var p = path[i];
            var m = ['M'];
            pushSnapPointFromClipperPoint(m, p[0]);
            result.push(m);
            var l = ['L'];
            for (var j = 1; j < p.length; ++j)
                pushSnapPointFromClipperPoint(l, p[j]);
            result.push(l);
        }
        return result;
    };

    // Simplify and clean up Clipper geometry
    Path.simplifyAndClean = function (geometry) {
        geometry = ClipperLib.Clipper.CleanPolygons(geometry, Path.cleanPolyDist);
        geometry = ClipperLib.Clipper.SimplifyPolygons(geometry, ClipperLib.PolyFillType.pftEvenOdd);
        return geometry;
    }

    // Clip Clipper geometry. clipType is a ClipperLib.ClipType constant. Returns new geometry.
    Path.clip = function (paths1, paths2, clipType) {
        var clipper = new ClipperLib.Clipper();
        clipper.AddPaths(paths1, ClipperLib.PolyType.ptSubject, true);
        clipper.AddPaths(paths2, ClipperLib.PolyType.ptClip, true);
        result = [];
        clipper.Execute(clipType, result, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
        return result;
    }

    // Return difference between to Clipper geometries. Returns new geometry.
    Path.diff = function (paths1, paths2) {
        return Path.clip(paths1, paths2, ClipperLib.ClipType.ctDifference);
    }

    // Offset Clipper geometries by amount (positive expands, negative shrinks). Returns new geometry.
    Path.offset = function(paths, amount) {
        var co = new ClipperLib.ClipperOffset(2, Path.arcTolerance);
        co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
        var offsetted = [];
        co.Execute(offsetted, amount);
        offsetted = ClipperLib.Clipper.CleanPolygons(offsetted, Path.cleanPolyDist);
        return offsetted;
    }
};
